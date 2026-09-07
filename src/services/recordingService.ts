import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { 
  AudioModule, 
  AudioRecorder, 
  requestRecordingPermissionsAsync, 
  RecordingPresets, 
  setAudioModeAsync 
} from 'expo-audio';
import { 
  StudioRecording, 
  getStudioRecordings, 
  saveStudioRecording, 
  deleteStudioRecordingStorage 
} from '../utils/storage';
import { showToast } from '../components/ToastNotification';

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

let activeRecorder: AudioRecorder | null = null;
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
  try {
    const res = await requestRecordingPermissionsAsync();
    return res.granted;
  } catch (e) {
    console.warn('[recordingService] permission request error:', e);
    return false;
  }
}

export async function startRecording(): Promise<void> {
  const granted = await requestRecordingPermissions();
  if (!granted) {
    showToast('Microphone permission required for Studio Recording', 'mic-off-outline');
    throw new Error('Microphone permission denied');
  }

  await ensureRecordingsDir();

  try {
    // Configure audio mode for recording
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    if (activeRecorder) {
      try {
        await activeRecorder.stop();
      } catch {}
      activeRecorder = null;
    }

    const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    await recorder.prepareToRecordAsync();
    recorder.record();

    activeRecorder = recorder;
    isRecordingState = true;
    isPausedState = false;
    recordingStartTime = Date.now();
    accumulatedDurationMs = 0;

    showToast('Recording started', 'mic');
  } catch (err: any) {
    console.error('[recordingService] Failed to start recording:', err);
    showToast(err?.message || 'Failed to start recording', 'alert-circle');
    isRecordingState = false;
    isPausedState = false;
    activeRecorder = null;
    throw err;
  }
}

export async function pauseRecording(): Promise<void> {
  if (activeRecorder && isRecordingState && !isPausedState) {
    try {
      activeRecorder.pause();
      accumulatedDurationMs += (Date.now() - recordingStartTime);
      isPausedState = true;
      showToast('Recording paused', 'pause');
    } catch (e) {
      console.warn('[recordingService] pause error:', e);
    }
  }
}

export async function resumeRecording(): Promise<void> {
  if (activeRecorder && isRecordingState && isPausedState) {
    try {
      activeRecorder.record();
      recordingStartTime = Date.now();
      isPausedState = false;
      showToast('Recording resumed', 'mic');
    } catch (e) {
      console.warn('[recordingService] resume error:', e);
    }
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
  if (!activeRecorder && !isRecordingState) {
    return null;
  }

  try {
    let recordedUri: string | null = null;
    let recordedDurationSec: number = 0;

    if (activeRecorder) {
      recordedUri = activeRecorder.uri;
      try {
        await activeRecorder.stop();
      } catch (err) {
        console.warn('[recordingService] stop error:', err);
      }
      if (!recordedUri) {
        recordedUri = activeRecorder.uri;
      }
      recordedDurationSec = activeRecorder.currentTime || 0;
    }

    if (!isPausedState) {
      accumulatedDurationMs += (Date.now() - recordingStartTime);
    }

    const durationSeconds = explicitDurationSeconds || recordedDurationSec || Math.round(accumulatedDurationMs / 1000) || 1;

    activeRecorder = null;
    isRecordingState = false;
    isPausedState = false;

    await ensureRecordingsDir();

    const timestamp = Date.now();
    const fileName = `cover_${timestamp}.m4a`;
    const destinationUri = `${RECORDINGS_DIR}${fileName}`;

    if (recordedUri) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(recordedUri);
        if (fileInfo.exists) {
          await FileSystem.copyAsync({
            from: recordedUri,
            to: destinationUri,
          });
        } else {
          await FileSystem.moveAsync({
            from: recordedUri,
            to: destinationUri,
          });
        }
      } catch (copyErr) {
        console.warn('[recordingService] copy/move error, falling back to recordedUri:', copyErr);
      }
    }

    let finalLocalUri = destinationUri;
    try {
      const destInfo = await FileSystem.getInfoAsync(destinationUri);
      if (!destInfo.exists && recordedUri) {
        finalLocalUri = recordedUri;
      }
    } catch {
      if (recordedUri) finalLocalUri = recordedUri;
    }

    const newRecording: StudioRecording = {
      id: `rec_${timestamp}`,
      songTitle: songTitle || 'Untitled Cover',
      artist: artist || 'Karaoke Studio',
      createdAt: timestamp,
      durationSeconds: durationSeconds,
      localUri: finalLocalUri,
    };

    saveStudioRecording(newRecording);
    showToast('Cover saved to Studio recordings!', 'checkmark-circle');

    // Reset audio mode back to normal playback
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {}

    return newRecording;
  } catch (err: any) {
    console.error('[recordingService] stopAndSaveRecording error:', err);
    showToast(err?.message || 'Failed to save recording', 'alert-circle');
    isRecordingState = false;
    isPausedState = false;
    activeRecorder = null;
    return null;
  }
}

export async function discardRecording(): Promise<void> {
  if (activeRecorder) {
    try {
      const tempUri = activeRecorder.uri;
      await activeRecorder.stop();
      if (tempUri) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
      }
    } catch (e) {
      console.warn('[recordingService] discard error:', e);
    }
  }

  activeRecorder = null;
  isRecordingState = false;
  isPausedState = false;
  recordingStartTime = 0;
  accumulatedDurationMs = 0;

  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  } catch {}
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

    const isWav = localUri.toLowerCase().endsWith('.wav');
    await Sharing.shareAsync(localUri, {
      mimeType: isWav ? 'audio/wav' : 'audio/m4a',
      dialogTitle: songTitle ? `Share Cover: ${songTitle}` : 'Share Studio Cover',
      UTI: 'public.audio',
    });
  } catch (err: any) {
    showToast(err?.message || 'Unable to share audio file', 'alert-circle');
  }
}

export { getStudioRecordings };
