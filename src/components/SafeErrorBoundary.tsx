import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
  fallbackName?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  errorText: string;
}

export class SafeErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorText: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorText: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn(`[SafeErrorBoundary:${this.props.fallbackName || 'Component'}] caught error:`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorText: '' });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <TouchableOpacity onPress={this.handleReset} style={styles.btn}>
            <Text style={styles.btnText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#0B0F17',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    margin: 16,
  },
  title: { color: '#94A3B8', fontSize: 14, marginBottom: 12 },
  btn: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  btnText: { color: '#06B6D4', fontSize: 13, fontWeight: '600' },
});
