import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { BRAND } from '@/src/config/brand';
import { describeAuthError } from '@/src/firebase/errors';

// This is the OAuth *web* client ID from the Firebase console, not anything inside
// google-services.json. The ID token must be audenced to the web client for
// GoogleAuthProvider.credential() to accept it.
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export type SignInOutcome =
  | { kind: 'success'; uid: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export function configureGoogleSignIn(): void {
  GoogleSignin.configure({
    webClientId,
    // Profile scope is what fills displayName/photoURL; nothing else is requested.
    scopeProfiles: true,
  });
}

export async function signInWithGoogle(): Promise<SignInOutcome> {
  try {
    if (!(await GoogleSignin.hasPlayServices())) {
      return { kind: 'error', message: 'This device is missing the Google Play services needed for sign-in.' };
    }
    const result = await GoogleSignin.signIn();
    const idToken = result?.data?.idToken;
    if (!idToken) return { kind: 'error', message: describeAuthError('invalid-credential') };

    const credential: FirebaseAuthTypes.AuthCredential = auth.GoogleAuthProvider.credential(idToken);
    const cred = await auth().signInWithCredential(credential);
    if (!cred.user) return { kind: 'error', message: describeAuthError('invalid-credential') };
    return { kind: 'success', uid: cred.user.uid };
  } catch (e) {
    const code = (e as { code?: number | string })?.code;
    if (code === statusCodes.SIGN_IN_CANCELLED) return { kind: 'cancelled' };
    const firebaseCode = (e as { code?: string })?.code;
    return { kind: 'error', message: describeAuthError(typeof firebaseCode === 'string' ? firebaseCode : 'unknown') };
  }
}

export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Google-side sign-out failures must not prevent the Firebase session from ending.
  }
  await auth().signOut();
}
