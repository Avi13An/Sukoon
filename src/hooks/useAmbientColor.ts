import { useState, useEffect } from 'react';
import { useActiveMediaItem } from '@rntp/player';
import { 
  subscribeToAmbientColor, 
  getActiveAmbientColor, 
  updateAmbientColorForTrack 
} from '../services/TrackPlayerService';

export function useAmbientColor(): string {
  const [ambientColor, setAmbientColor] = useState<string>(getActiveAmbientColor);
  const activeItem = useActiveMediaItem();

  useEffect(() => {
    if (activeItem) {
      updateAmbientColorForTrack(activeItem as any);
    }
  }, [activeItem]);

  useEffect(() => {
    const unsubscribe = subscribeToAmbientColor((newColor) => {
      setAmbientColor(newColor);
    });
    return unsubscribe;
  }, []);

  return ambientColor;
}
