package stream.z

import android.util.Log
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Resolves hostnames over DNS-over-HTTPS instead of the network's own resolver.
 *
 * Why this exists: on several Wi-Fi networks in this app's user base, the local resolver
 * answers `api.themoviedb.org` with an address that accepts a TCP connection and then
 * drops the TLS handshake. The app cannot tell that apart from the API being offline, so
 * Home came up empty until the user turned on a VPN. A VPN "fixed" it only because it
 * moved DNS somewhere else. This does the same thing in-process: it asks a resolver the
 * network cannot rewrite, and connects to the address that resolver returns.
 *
 * What is deliberately *not* changed: TLS. The hostname still goes to OkHttp untouched,
 * so the certificate is still checked against `api.themoviedb.org`; only the address the
 * certificate is presented at comes from somewhere else. Nothing here is pinned,
 * bypassed, or hard-coded per host.
 *
 * Failure behaviour is the old behaviour. If both DoH endpoints are unreachable —
 * a captive portal, a network that blocks public resolvers — the system resolver answers
 * exactly as it did before this class existed. A negative result is cached briefly so a
 * blocked resolver cannot turn every request into a timeout.
 */
class DohDns(
  private val fallback: Dns = Dns.SYSTEM,
  private val positiveTtlMs: Long = 10 * 60_000,
  private val negativeTtlMs: Long = 30_000,
) : Dns {

  private data class Entry(val addresses: List<InetAddress>, val expiresAt: Long)

  private val cache = ConcurrentHashMap<String, Entry>()

  /**
   * Built without this class: both endpoints are IP literals and their certificates carry
   * the address as a SAN, so reaching them needs no lookup. Handing this client a `Dns`
   * that calls back into itself would be a loop.
   */
  private val client = OkHttpClient.Builder()
    .connectTimeout(3, TimeUnit.SECONDS)
    .readTimeout(3, TimeUnit.SECONDS)
    .callTimeout(4, TimeUnit.SECONDS)
    .build()

  private val endpoints = listOf(
    "https://1.1.1.1/dns-query" to "application/dns-json",
    "https://8.8.8.8/resolve" to "application/json",
  )

  override fun lookup(hostname: String): List<InetAddress> {
    if (isLiteral(hostname) || hostname.equals("localhost", ignoreCase = true)) {
      return fallback.lookup(hostname)
    }

    val now = System.currentTimeMillis()
    cache[hostname]?.let { if (it.expiresAt > now) return it.addresses }

    val resolved = queryDoH(hostname)
    if (resolved.isNotEmpty()) {
      cache[hostname] = Entry(resolved, now + positiveTtlMs)
      return resolved
    }

    val system = fallback.lookup(hostname)
    cache[hostname] = Entry(system, now + negativeTtlMs)
    return system
  }

  private fun queryDoH(hostname: String): List<InetAddress> {
    for ((url, accept) in endpoints) {
      try {
        val request = Request.Builder()
          .url("$url?name=$hostname&type=A")
          .header("accept", accept)
          .build()
        client.newCall(request).execute().use { response ->
          if (!response.isSuccessful) return@use
          val answer = JSONObject(response.body?.string() ?: return@use)
            .optJSONArray("Answer") ?: return@use
          val addresses = ArrayList<InetAddress>(answer.length())
          for (i in 0 until answer.length()) {
            val record = answer.optJSONObject(i) ?: continue
            // Type 1 is an A record. AAAA is left to the system resolver: every network
            // that poisons A answers this app has met so far has no working IPv6 path.
            if (record.optInt("type") != 1) continue
            val data = record.optString("data").trim()
            val address = runCatching { InetAddress.getByName(data) }.getOrNull() ?: continue
            if (!addresses.contains(address)) addresses.add(address)
          }
          if (addresses.isNotEmpty()) return addresses
        }
      } catch (error: Exception) {
        Log.w(TAG, "DoH lookup failed for $hostname via $url: ${error.javaClass.simpleName}")
      }
    }
    return emptyList()
  }

  private fun isLiteral(hostname: String): Boolean =
    hostname.indexOf(':') >= 0 || IPV4.matches(hostname)

  private companion object {
    const val TAG = "StreamZDns"
    val IPV4 = Regex("""\d{1,3}(\.\d{1,3}){3}""")
  }
}
