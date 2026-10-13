package expo.modules.apkintegrity

import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

/**
 * Reads the three facts the in-app updater must be able to answer about a downloaded APK before it
 * is handed to the Android installer: which bytes this file is (SHA-256), which application claims
 * to be inside it (package name), and who signed it (SHA-256 of the DER signing certificate).
 *
 * None of this is reachable from JavaScript. `expo-file-system` exposes no digest API, reading
 * `AndroidManifest.xml` out of the archive by hand would say nothing about the signature, and a
 * certificate only becomes comparable once it is decoded and hashed the way `keytool -list` and
 * `apksigner verify --print-certs` hash it — which is what lets a published policy be checked
 * against the device's own read-out.
 *
 * Every field is nullable and null means "could not be measured". `evaluateApkIntegrity` treats a
 * missing measurement as a refusal, so an unreadable archive, a truncated download, or a device
 * whose package manager declines to parse the file cannot be mistaken for a verified update.
 */
class ApkIntegrityModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("ExpoApkIntegrity")

    // AsyncFunction bodies run on Expo's module queue rather than the UI thread, which is where a
    // hash over tens of megabytes belongs.
    AsyncFunction("inspectApk") { path: String ->
      inspect(path)
    }

    AsyncFunction("sha256OfFile") { path: String ->
      mapOf("sha256" to runCatching { sha256(File(path)) }.getOrNull())
    }
  }

  private fun inspect(path: String): Map<String, Any?> {
    val file = File(path)
    val readable = file.isFile && file.canRead()
    return mapOf(
      "exists" to readable,
      // A download that stopped early changes both the size and the digest, so the caller can tell
      // a truncated file from a substituted one instead of trusting the HTTP response.
      "sizeBytes" to if (readable) file.length() else null,
      "sha256" to if (readable) runCatching { sha256(file) }.getOrNull() else null,
      "packageName" to if (readable) runCatching { archivePackageName(file) }.getOrNull() else null,
      "signingCertSha256" to if (readable) runCatching { signingCertSha256(file) }.getOrNull() else null
    )
  }

  /**
   * Streamed through a fixed buffer, never loaded whole: the release APK is tens of megabytes and
   * this runs on the low-memory devices the app is distributed to.
   */
  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().toHex()
  }

  private fun archiveInfo(file: File): android.content.pm.PackageInfo? {
    val pm = appContext.reactContext?.packageManager ?: return null
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      @Suppress("DEPRECATION")
      PackageManager.GET_SIGNATURES
    }
    return pm.getPackageArchiveInfo(file.absolutePath, flags)
  }

  private fun archivePackageName(file: File): String? = archiveInfo(file)?.packageName

  /**
   * The signed certificate as DER, from whichever API level the device offers. `Signature#toByteArray`
   * and `X509Certificate#getEncoded` both return the encoded certificate, so the bytes hashed below
   * are the certificate itself on every path.
   */
  @Suppress("DEPRECATION")
  private fun signerDer(file: File): ByteArray? {
    val info = archiveInfo(file) ?: return null
    return when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
        info.signingInfo?.apkContentsSignersCertificate?.encoded
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ->
        info.signingInfo?.apkContentSigners?.firstOrNull()?.toByteArray()
      else -> info.signatures?.firstOrNull()?.toByteArray()
    }
  }

  @Suppress("DEPRECATION")
  private fun signingCertSha256(file: File): String? {
    val der = signerDer(file) ?: return null
    val cert = runCatching {
      CertificateFactory.getInstance("X.509")
        .generateCertificate(ByteArrayInputStream(der)) as? X509Certificate
    }.getOrNull() ?: return null
    return MessageDigest.getInstance("SHA-256").digest(cert.encoded).toHex()
  }

  private fun ByteArray.toHex(): String =
    joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
}
