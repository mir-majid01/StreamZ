import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithCredential,
  signOut as firebaseSignOut,
} from '@react-native-firebase/auth';
import { GOOGLE_WEB_CLIENT_ID } from '@/src/config/env';
import { describeAuthError } from '@/src/firebase/errors';

export type SignInOutcome =
  | { kind: 'success'; uid: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export function configureGoogleSignIn(): void {
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
}

export async function signInWithGoogle(): Promise<SignInOutcome> {
  try {
    if (!(await GoogleSignin.hasPlayServices())) {
      return {
        kind: 'error',
        message: 'This device is missing the Google Play services needed for sign-in.',
      };
    }
    const result = await GoogleSignin.signIn();
    const idToken = result?.data?.idToken;
    if (!idToken) return { kind: 'error', message: describeAuthError('invalid-credential') };

    const credential = GoogleAuthProvider.credential(idToken);
    const signedIn = await signInWithCredential(getAuth(), credential);
    if (!signedIn.user) return { kind: 'error', message: describeAuthError('invalid-credential') };
    return { kind: 'success', uid: signedIn.user.uid };
  } catch (e) {
    const code = (e as { code?: number | string })?.code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === 'cancel') return { kind: 'cancelled' };
    // Users get friendly copy, developers get the number. Google's numeric status codes
    // (10 = DEVELOPER_ERROR, 2 = timeout, 12500 series) are the only way to tell a
    // mis-registered SHA-1 apart from a cancelled prompt, and they arrive here as numbers.
    console.warn('[auth] Google sign-in failed', code, (e as { message?: string })?.message);
    return {
      kind: 'error',
      message: describeAuthError(typeof code === 'string' ? code : 'unknown'),
    };
  }
}

export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // A Google-side failure must not prevent the Firebase session from ending.
  }
  await firebaseSignOut(getAuth());
}
