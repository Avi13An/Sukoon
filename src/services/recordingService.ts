import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { 
  StudioRecording, 
  getStudioRecordings, 
  saveStudioRecording, 
  deleteStudioRecordingStorage 
} from '../utils/storage';

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

let currentRecording: Audio.Recording | null = null;
let recordingStartTime: number = 0;
let accumulatedDurationMs: number = 0;
let isPaused: boolean = false;

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
    const response = await Audio.requestPermissionsAsync();
    return response.granted;
  } catch (err) {
    console.warn('Error requesting audio permissions:', err);
    return false;
  }
}

export async function startRecording(): Promise<void> {
  const hasPermission = await requestRecordingPermissions();
  if (!hasPermission) {
    throw new Error('Microphone permission is required to record vocals.');
  }

  // If there's an existing recording, discard it first
  if (currentRecording) {
    await discardRecording();
  }

  // Configure audio mode to allow simultaneous playback (BGM) and recording (mic)
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();

  currentRecording = recording;
  recordingStartTime = Date.now();
  accumulatedDurationMs = 0;
  isPaused = false;
}

export async function pauseRecording(): Promise<void> {
  if (currentRecording && !isPaused) {
    try {
      await currentRecording.pauseAsync();
      accumulatedDurationMs += (Date.now() - recordingStartTime);
      isPaused = true;
    } catch (err) {
      console.warn('Failed to pause recording:', err);
    }
  }
}

export async function resumeRecording(): Promise<void> {
  if (currentRecording && isPaused) {
    try {
      await currentRecording.startAsync();
      recordingStartTime = Date.now();
      isPaused = false;
    } catch (err) {
      console.warn('Failed to resume recording:', err);
    }
  }
}

export function isRecording(): boolean {
  return currentRecording !== null && !isPaused;
}

export function isRecordingPaused(): boolean {
  return currentRecording !== null && isPaused;
}

export async function stopAndSaveRecording(
  songTitle: string,
  artist: string,
  explicitDurationSeconds?: number
): Promise<StudioRecording | null> {
  if (!currentRecording) return null;

  try {
    let finalDurationSec = explicitDurationSeconds;
    if (!finalDurationSec) {
      const activeMs = !isPaused ? (Date.now() - recordingStartTime) : 0;
      finalDurationSec = Math.max(1, Math.round((accumulatedDurationMs + activeMs) / 1000));
    }

    await currentRecording.stopAndUnloadAsync();
    const tempUri = currentRecording.getURI();
    currentRecording = null;
    isPaused = false;

    // Reset audio mode back to standard playback
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });

    if (!tempUri) return null;

    await ensureRecordingsDir();
    const id = `rec_${Date.now()}`;
    const filename = `${id}.m4a`;
    const finalUri = `${RECORDINGS_DIR}${filename}`;

    await FileSystem.copyAsync({
      from: tempUri,
      to: finalUri,
    });

    // Cleanup temp recording file
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {}

    let sizeBytes: number | undefined;
    try {
      const info = await FileSystem.getInfoAsync(finalUri);
      if (info.exists && 'size' in info) {
        sizeBytes = info.size;
      }
    } catch {}

    const recordingItem: StudioRecording = {
      id,
      songTitle: songTitle || 'Untitled Cover',
      artist: artist || 'Unknown Artist',
      localUri: finalUri,
      createdAt: Date.now(),
      durationSeconds: Math.max(1, Math.round(finalDurationSec)),
      fileSizeBytes: sizeBytes,
    };

    saveStudioRecording(recordingItem);
    return recordingItem;
  } catch (err) {
    console.error('Error stopping and saving recording:', err);
    currentRecording = null;
    isPaused = false;
    return null;
  }
}

export async function discardRecording(): Promise<void> {
  if (currentRecording) {
    try {
      await currentRecording.stopAndUnloadAsync();
      const tempUri = currentRecording.getURI();
      if (tempUri) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
      }
    } catch (err) {
      console.warn('Error discarding recording:', err);
    }
    currentRecording = null;
    isPaused = false;
  }

  // Restore audio mode
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
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
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Sharing is not available on this device');
  }

  await Sharing.shareAsync(localUri, {
    mimeType: 'audio/m4a',
    dialogTitle: songTitle ? `Share Cover: ${songTitle}` : 'Share Studio Cover',
    UTI: 'public.audio',
  });
}

export { getStudioRecordings };
