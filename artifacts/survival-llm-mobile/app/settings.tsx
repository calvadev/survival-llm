/**
 * Settings: what's installed, storage housekeeping, and about the app.
 */
import React from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { MODELS } from '@/lib/catalog';
import { useApp } from '@/lib/state';

function Row({
  title,
  meta,
  action,
  onAction,
  danger,
}: {
  title: string;
  meta?: string;
  action?: string;
  onAction?: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15.5 }}>{title}</Text>
        {!!meta && <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{meta}</Text>}
      </View>
      {!!action && (
        <Pressable
          onPress={onAction}
          style={[styles.btn, danger ? { borderColor: colors.destructive } : { backgroundColor: colors.primary }]}
        >
          <Text style={{ color: danger ? colors.destructive : colors.primaryForeground, fontWeight: '600', fontSize: 13.5 }}>
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const app = useApp();
  const modelMeta = app.model
    ? MODELS.find((m) => m.key === app.model!.key)
    : null;

  const confirm = (what: string, then: () => void) => {
    if (Platform.OS === 'web') {
      then(); // Alert.alert is a no-op on web previews
      return;
    }
    Alert.alert(what, 'You can download it again while you have internet.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: then },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={[styles.group, { color: colors.mutedForeground }]}>AI MODEL</Text>
      {app.model ? (
        <Row
          title={modelMeta?.name ?? 'Custom model'}
          meta={modelMeta ? `${modelMeta.gb} download · by ${modelMeta.maker}` : 'Your own GGUF file'}
          action="Delete"
          danger
          onAction={() => confirm('Delete the AI model?', () => void app.forgetModel())}
        />
      ) : (
        <Row title="No AI model yet" meta="Answers need one." action="Set up" onAction={() => router.push('/setup')} />
      )}
      <Pressable onPress={() => router.push('/setup')} style={{ marginTop: 8 }}>
        <Text style={{ color: colors.primary, fontSize: 14 }}>Change or download a model…</Text>
      </Pressable>

      <Text style={[styles.group, { color: colors.mutedForeground }]}>LIBRARY</Text>
      {app.libraryInfo ? (
        <Row
          title={app.libraryInfo.pack === 'lite' ? 'Essentials' : 'Everything'}
          meta={`${app.libraryInfo.articles.toLocaleString()} articles${app.libraryInfo.version ? ` · ${app.libraryInfo.version}` : ''}`}
          action="Delete"
          danger
          onAction={() => confirm('Delete the library?', () => void app.forgetLibrary())}
        />
      ) : (
        <Row title="No library yet" meta="Sources and article reading need it." action="Set up" onAction={() => router.push('/setup')} />
      )}
      <Pressable onPress={() => router.push('/library')} style={{ marginTop: 8 }} disabled={!app.libraryInfo}>
        <Text style={{ color: app.libraryInfo ? colors.primary : colors.mutedForeground, fontSize: 14 }}>
          Search the library yourself…
        </Text>
      </Pressable>

      <Text style={[styles.group, { color: colors.mutedForeground }]}>ABOUT</Text>
      <View style={[styles.about, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>Survival LLM for Android</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
          An offline AI assistant and survival library. The AI model and the library live on this phone; your
          questions never leave it, and once set up it works with the internet off.
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 13.5, marginTop: 8, lineHeight: 20 }}>
          AI can make mistakes. Every answer shows its sources so you can check.
        </Text>
        {!app.engineHere && (
          <Text style={{ color: colors.statusWarn, fontSize: 13, marginTop: 8, lineHeight: 19 }}>
            This is the Expo Go preview: on-device AI answers run in the installed Android app, not here.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  group: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.6, marginTop: 22, marginBottom: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 14 },
  btn: { borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'transparent' },
  about: { borderWidth: 1, borderRadius: 12, padding: 14 },
});
