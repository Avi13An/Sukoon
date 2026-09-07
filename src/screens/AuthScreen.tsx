import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator, 
  KeyboardAvoidingView, 
  Platform,
  StatusBar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loginUser, registerUser, getUserPlaylists, notifyStorageChanged } from '../utils/storage';
import { supabase } from '../services/supabase';

interface Props {
  navigation: any;
}

export function AuthScreen({ navigation }: Props) {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const rawUser = username.trim();
    const cleanPass = password.trim();

    if (!rawUser) {
      setError('Please enter a username.');
      return;
    }
    if (rawUser.length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    if (!cleanPass) {
      setError('Please enter a password.');
      return;
    }
    if (cleanPass.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      if (isLoginMode) {
        const result = loginUser(rawUser, cleanPass);
        if (!result.success) {
          setError(result.error || 'Invalid username or password.');
          setIsLoading(false);
          return;
        }
      } else {
        const result = registerUser(rawUser, cleanPass);
        if (!result.success) {
          setError(result.error || 'Username already exists. Please log in.');
          setIsLoading(false);
          return;
        }

        // Asynchronously sync profile to Supabase if available
        try {
          await supabase.from('profiles').upsert([{ username: rawUser.toLowerCase() }]);
        } catch {}
      }

      // Trigger playlist reload / state sync so the user's custom playlists and liked songs immediately appear
      getUserPlaylists();
      notifyStorageChanged();

      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    } catch (err: any) {
      setError(err?.message || 'Authentication error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.content}>
        
        {/* Branding */}
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Ionicons name="musical-notes" size={32} color="#00ffcc" />
          </View>
          <Text style={styles.appTitle}>Sukoon</Text>
          <Text style={styles.appSubtitle}>
            {isLoginMode 
              ? 'Sign in to access your custom playlists and library' 
              : 'Create your private music profile with cloud backup'}
          </Text>
        </View>

        {/* Auth Mode Toggle Tabs */}
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tab, isLoginMode && styles.tabActive]} 
            onPress={() => { setIsLoginMode(true); setError(''); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, isLoginMode && styles.tabTextActive]}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, !isLoginMode && styles.tabActive]} 
            onPress={() => { setIsLoginMode(false); setError(''); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, !isLoginMode && styles.tabTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        {/* Input Fields */}
        <View style={styles.inputWrapper}>
          <Ionicons name="person-outline" size={20} color="#888888" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#666666"
            value={username}
            onChangeText={(text) => { setUsername(text); setError(''); }}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
        </View>

        <View style={styles.inputWrapper}>
          <Ionicons name="lock-closed-outline" size={20} color="#888888" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#666666"
            value={password}
            onChangeText={(text) => { setPassword(text); setError(''); }}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
          <TouchableOpacity 
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeIconBtn}
          >
            <Ionicons 
              name={showPassword ? "eye-off-outline" : "eye-outline"} 
              size={20} 
              color="#888888" 
            />
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color="#ff5252" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Action Button */}
        <TouchableOpacity 
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]} 
          onPress={handleSubmit}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <Text style={styles.submitButtonText}>
              {isLoginMode ? 'Sign In to Sukoon' : 'Create Account'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.footerNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color="#00ffcc" />
          <Text style={styles.footerNoteText}>
            Mandatory credentials protect your private playlists and local downloads.
          </Text>
        </View>

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
    paddingHorizontal: 28,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#0d0d0d',
    borderWidth: 1,
    borderColor: '#222222',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  appTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: '#888888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    maxWidth: 280,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#0d0d0d',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: '#1c1c1c',
  },
  tabText: {
    color: '#777777',
    fontSize: 15,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222222',
    marginBottom: 14,
    paddingHorizontal: 16,
    height: 54,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#ffffff',
    fontSize: 16,
  },
  eyeIconBtn: {
    padding: 6,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 82, 82, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: '#ff5252',
    fontSize: 13,
    flex: 1,
  },
  submitButton: {
    backgroundColor: '#00ffcc',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    gap: 6,
    paddingHorizontal: 12,
  },
  footerNoteText: {
    color: '#666666',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
});
