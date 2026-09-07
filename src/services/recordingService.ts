import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { 
  StudioRecording, 
  getStudioRecordings, 
  saveStudioRecording, 
  deleteStudioRecordingStorage 
} from '../utils/storage';
import { showToast } from '../components/ToastNotification';

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

let isRecordingState: boolean = false;
let isPausedState: boolean = false;
let recordingStartTime: number = 0;
let accumulatedDurationMs: number = 0;

async function ensureRecordingsDir(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    }
  } catch (err) {
    console.warn('Error ensuring recordings dir:', err);
  }
}

export async function requestRecordingPermissions(): Promise<boolean> {
  return false;
}

export async function startRecording(): Promise<void> {
  // Graceful stub to avoid native C++ dlopen UnsatisfiedLinkError crashes on modern runtimes
  showToast('Recording requires standalone native microphone module', 'mic-off-outline');
  throw new Error('Recording requires standalone native microphone module.');
}

export async function pauseRecording(): Promise<void> {
  if (isRecordingState && !isPausedState) {
    accumulatedDurationMs += (Date.now() - recordingStartTime);
    isPausedState = true;
  }
}

export async function resumeRecording(): Promise<void> {
  if (isRecordingState && isPausedState) {
    recordingStartTime = Date.now();
    isPausedState = false;
  }
}

export function isRecording(): boolean {
  return isRecordingState && !isPausedState;
}

export function isRecordingPaused(): boolean {
  return isRecordingState && isPausedState;
}

export async function stopAndSaveRecording(
  songTitle: string,
  artist: string,
  explicitDurationSeconds?: number
): Promise<StudioRecording | null> {
  isRecordingState = false;
  isPausedState = false;
  showToast('Recording requires standalone native microphone module', 'mic-off-outline');
  return null;
}

export async function discardRecording(): Promise<void> {
  isRecordingState = false;
  isPausedState = false;
  recordingStartTime = 0;
  accumulatedDurationMs = 0;
}

export async function deleteRecording(id: string, localUri: string): Promise<void> {
  try {
    deleteStudioRecordingStorage(id);
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists) {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    }
  } catch (err) {
    console.warn('Error deleting recording:', err);
  }
}

export async function shareRecording(localUri: string, songTitle?: string): Promise<void> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      showToast('Sharing is not available on this device', 'alert-circle');
      return;
    }

    await Sharing.shareAsync(localUri, {
      mimeType: 'audio/m4a',
      dialogTitle: songTitle ? `Share Cover: ${songTitle}` : 'Share Studio Cover',
      UTI: 'public.audio',
    });
  } catch (err: any) {
    showToast(err?.message || 'Unable to share audio file', 'alert-circle');
  }
}

export { getStudioRecordings };
