import { supabase } from './supabase';
import { Playlist, getMyUsername, getPlaylists, savePlaylists } from '../utils/storage';

export async function sharePlaylist(playlist: Playlist, targetUsername: string) {
  const myUsername = getMyUsername();
  if (!myUsername) throw new Error('User not registered');

  // Push to Supabase
  const { error } = await supabase.from('shared_playlists').insert([
    {
      shared_by: myUsername,
      shared_username: targetUsername.toLowerCase(),
      playlist_data: playlist,
    }
  ]);

  if (error) {
    console.error('Error sharing playlist:', error);
    throw error;
  }
}

export function subscribeToSharedPlaylists(onNewPlaylist?: (playlist: Playlist) => void) {
  const myUsername = getMyUsername();
  if (!myUsername) return null;

  const subscription = supabase
    .channel('public:shared_playlists')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'shared_playlists',
        filter: `shared_username=eq.${myUsername.toLowerCase()}`,
      },
      (payload) => {
        const incomingPlaylist = payload.new.playlist_data as Playlist;
        if (incomingPlaylist) {
          // Add marker to indicate it was shared
          incomingPlaylist.name = `${incomingPlaylist.name} (Shared by ${payload.new.shared_by})`;
          
          // Save to local MMKV
          const localPlaylists = getPlaylists();
          // Ensure we don't duplicate by ID, but since it's a shared one, we could give it a new ID to prevent clashes
          incomingPlaylist.id = `shared_${Date.now()}`;
          localPlaylists.push(incomingPlaylist);
          savePlaylists(localPlaylists);

          if (onNewPlaylist) {
            onNewPlaylist(incomingPlaylist);
          }
        }
      }
    )
    .subscribe();

  return subscription;
}
