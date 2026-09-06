import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../services/supabase';
import { setMyUsername } from '../utils/storage';

export function SetupScreen({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleClaim = async () => {
    const trimmed = username.trim().toLowerCase();
    if (trimmed.length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      // Race remote Supabase check with a 2.5s timeout so unreachable servers never hang the UI
      const timeoutPromise = new Promise<{ timeout: boolean }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), 2500)
      );

      const remoteCheck = async (): Promise<{ isTaken: boolean; error?: any }> => {
        try {
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', trimmed)
            .single();
            
          if (data) {
            return { isTaken: true };
          }
          
          // Only attempt insert if no fetch error or "no rows found" (PGRST116)
          if (!fetchError || fetchError.code === 'PGRST116') {
            await supabase
              .from('profiles')
              .insert([{ username: trimmed }]);
          }
          return { isTaken: false };
        } catch (err) {
          return { isTaken: false, error: err };
        }
      };

      const result = await Promise.race([remoteCheck(), timeoutPromise]);

      if ('isTaken' in result && result.isTaken) {
        setError('Username is already taken.');
        setIsLoading(false);
        return;
      }

      // If remote check was successful, timed out, or threw network error, proceed with username
      console.log('[SetupScreen] Username claimed:', trimmed);
      setMyUsername(trimmed);
      navigation.replace('MainTabs');
    } catch (e: any) {
      console.warn('[SetupScreen] Remote sync unavailable, proceeding in local mode:', e?.message || e);
      setMyUsername(trimmed);
      navigation.replace('MainTabs');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipGuest = () => {
    const guestUsername = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
    setMyUsername(guestUsername);
    navigation.replace('MainTabs');
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Welcome</Text>
        <Text style={styles.subtitle}>Choose a unique username to enable cloud syncing and shared playlists.</Text>
        
        <TextInput
          style={styles.input}
          placeholder="Enter username"
          placeholderTextColor="#888888"
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            setError('');
          }}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
        />
        
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        
        <TouchableOpacity 
          style={[styles.button, isLoading && styles.buttonDisabled]} 
          onPress={handleClaim}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <Text style={styles.buttonText}>Claim Username</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.guestButton} 
          onPress={handleSkipGuest}
          disabled={isLoading}
        >
          <Text style={styles.guestButtonText}>Skip as Guest</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: '#aaaaaa',
    fontSize: 16,
    marginBottom: 32,
    lineHeight: 24,
  },
  input: {
    backgroundColor: '#121212',
    color: '#ffffff',
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333333',
  },
  errorText: {
    color: '#ff4444',
    marginBottom: 16,
    fontSize: 14,
  },
  button: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  guestButton: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
  },
  guestButtonText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '500',
  },
});
