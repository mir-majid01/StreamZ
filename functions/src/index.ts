import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

export { validateAccess } from './validateAccess';
export { activateKey } from './activateKey';
export { generateKeys, revokeKey, setAdminRole } from './manageKeys';
export { onWatchSessionWritten, finalizeStaleSessions } from './rollups';
