import { setGlobalOptions } from 'firebase-functions/v2';
import { initialize } from 'firebase-admin';

initialize();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

export { validateAccess } from './validateAccess';
export { activateKey } from './activateKey';
export { generateKeys, revokeKey, setAdminRole } from './manageKeys';
export { onWatchSessionWritten, finalizeStaleSessions } from './rollups';
