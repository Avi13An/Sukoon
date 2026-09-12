import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

export interface RenamePlaylistModalProps {
  visible: boolean;
  initialTitle: string;
  onSave: (newTitle: string) => void | Promise<void>;
  onClose: () => void;
}

export function RenamePlaylistModal({
  visible,
  initialTitle,
  onSave,
  onClose,
}: RenamePlaylistModalProps) {
  const [titleText, setTitleText] = useState(initialTitle);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitleText(initialTitle || '');
      setIsSaving(false);
    }
  }, [visible, initialTitle]);

  if (!visible) return null;

  const handleSave = async () => {
    const trimmed = titleText.trim();
    if (!trimmed || isSaving) return;
    try {
      setIsSaving(true);
      await onSave(trimmed);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoid}
          >
            <TouchableWithoutFeedback>
              <View style={styles.card}>
                <Text style={styles.title}>Rename Playlist</Text>

                <TextInput
                  style={styles.input}
                  value={titleText}
                  onChangeText={setTitleText}
                  placeholder="Enter playlist name"
                  placeholderTextColor="#666666"
                  autoFocus
                  selectTextOnFocus
                  maxLength={60}
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={onClose}
                    activeOpacity={0.8}
                    disabled={isSaving}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.saveBtn, !titleText.trim() && styles.saveBtnDisabled]}
                    onPress={handleSave}
                    activeOpacity={0.8}
                    disabled={!titleText.trim() || isSaving}
                  >
                    <Text style={styles.saveText}>{isSaving ? 'Saving...' : 'Save'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  keyboardAvoid: {
    width: '100%',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 18,
    textAlign: 'center',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
    marginBottom: 22,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: '#aaaaaa',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: '#00ffcc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
});
