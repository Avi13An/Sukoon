import { 
  registerUser as storageRegisterUser, 
  loginUser as storageLoginUser, 
  clearActiveSession,
  getActiveUserSession, 
  getActiveUser, 
  getUsersRegistry, 
  StoredUserAccount, 
  ActiveSession,
  hydrateUserData
} from '../utils/storage';
import { logoutUser as downloadLogoutUser } from './downloadService';

export type { StoredUserAccount, ActiveSession };

export function registerUser(username: string, password: string) {
  return storageRegisterUser(username, password);
}

export function loginUser(username: string, password: string) {
  return storageLoginUser(username, password);
}

export async function logoutUser(): Promise<void> {
  await downloadLogoutUser();
}

export { 
  getActiveUserSession, 
  getActiveUser, 
  getUsersRegistry,
  clearActiveSession,
  hydrateUserData 
};
