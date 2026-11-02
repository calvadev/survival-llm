/**
 * The chat screen — the whole product on one screen, like the desktop app:
 * questions and streamed answers, sources you can tap, and a composer.
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useColors } from '@/hooks/useColors';
import { MessageBubble } from '@/components/Message';
import { useApp } from '@/lib/state';

const EXAMPLES = [
  'The power is out. How long is the food in my fridge safe?',
  'Where can I safely run a generator?',
  'How do I make tap water safe to drink?',
  'Someone burned their hand on the stove. What do I do?',
];

function Logo({ color }: { color: string }) {
  // The desktop logo: an amber ring with a filled core (app/static/app.css .logo).
  return (
    <View style={[styles.logo, { borderColor: color }]}>
      <View style={[styles.logoCore, { backgroundColor: color }]} />
    </View>
  );
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const app = useApp();
  const [input, setInput] = useState('');

  const ready = !!app.model && !!app.libraryInfo;
  const downloading = app.jobs.some((j) => ['downloading', 'verifying', 'unpacking'].includes(j.status));
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const status = useMemo(() => {
    if (downloading) return { kind: 'warn', text: 'Setting up… downloads keep going if you leave' };
    if (ready) {
      const arts = app.libraryInfo ? `${Math.round(app.libraryInfo.articles / 1000)}k articles` : '';
      return { kind: 'on', text: `Ready to use without internet${arts ? ' · ' + arts : ''}` };
    }
    const missing = [!app.model && 'an AI model', !app.libraryInfo && 'the library'].filter(Boolean).join(' and ');
    return { kind: 'warn', text: `Setup not finished: needs ${missing}` };
  }, [downloading, ready, app.model, app.libraryInfo]);

  const statusColor =
    status.kind === 'on' ? colors.statusOn : status.kind === 'warn' ? colors.statusWarn : colors.statusOff;

  const sendNow = (text: string) => {
    setInput('');
    void app.send(text);
  };

  const reversed = useMemo(() => [...app.messages].reverse(), [app.messages]);

  // Setup card / welcome content shown while there are no messages. Rendered
  // outside the (inverted) FlatList because an empty inverted list collapses
  // its ListFooterComponent on web, leaving a blank body.
  const emptyState = (
    <View>
      {!ready && (
        <Pressable
          onPress={() => router.push('/setup')}
          style={[styles.setupCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.setupTitle, { color: colors.text }]}>Set up Survival LLM</Text>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21, marginTop: 6 }}>
            Download the AI and the library once, while you have internet. After that this app works
            with none — every answer shows the passage it came from.
          </Text>
          <View style={[styles.setupBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
              {downloading ? 'See downloads' : 'Start setup'}
            </Text>
          </View>
        </Pressable>
      )}
      {ready && app.messages.length === 0 && (
        <View style={{ paddingTop: 24 }}>
          <Text style={[styles.welcomeTitle, { color: colors.text }]}>Ask anything. No internet needed.</Text>
          <Text style={{ color: colors.mutedForeground, lineHeight: 22, marginTop: 8 }}>
            A local AI looks things up in an offline library of medical, emergency, how-to and
            encyclopedia articles, then tells you where each answer came from. Tap a source to read
            it yourself.
          </Text>
          <View style={{ marginTop: 16, gap: 10 }}>
            {EXAMPLES.map((q) => (
              <Pressable
                key={q}
                onPress={() => sendNow(q)}
                style={({ pressed }) => [
                  styles.example,
                  {
                    backgroundColor: colors.card,
                    borderColor: pressed ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: colors.text, lineHeight: 20 }}>{q}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12.5, textAlign: 'center', marginTop: 18 }}>
            AI can make mistakes. Check the sources.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* header — mirrors the desktop top bar */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Logo color={colors.primary} />
        <View style={styles.headerText}>
          <Text style={[styles.brand, { color: colors.text }]}>Survival LLM</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12.5, flexShrink: 1 }}>
              {status.text}
            </Text>
          </View>
        </View>
        {!!app.libraryInfo && (
          <Pressable hitSlop={10} onPress={() => router.push('/library')} accessibilityLabel="Search the library">
            <Feather name="search" size={21} color={colors.mutedForeground} />
          </Pressable>
        )}
        <Pressable hitSlop={10} onPress={() => app.newChat()} accessibilityLabel="New chat">
          <Feather name="plus" size={22} color={colors.mutedForeground} />
        </Pressable>
        <Pressable hitSlop={10} onPress={() => router.push('/settings')} accessibilityLabel="Settings">
          <Feather name="settings" size={21} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
        {app.loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : reversed.length === 0 ? (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {emptyState}
          </ScrollView>
        ) : (
          <FlatList
            inverted
            data={reversed}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble msg={item} />}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={emptyState}
          />
        )}

        {/* composer */}
        <View
          style={[
            styles.composer,
            { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(bottomPad, 10) },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={ready ? 'Ask a question…' : 'Set up the app first…'}
            placeholderTextColor={colors.mutedForeground}
            multiline
            editable={ready && !app.busy}
            style={[
              styles.input,
              { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
            ]}
          />
          <Pressable
            onPress={() => (app.busy ? void app.stop() : input.trim() && sendNow(input))}
            disabled={!app.busy && (!ready || !input.trim())}
            style={[
              styles.send,
              {
                backgroundColor:
                  app.busy ? colors.destructive : ready && input.trim() ? colors.primary : colors.border,
              },
            ]}
            accessibilityLabel={app.busy ? 'Stop' : 'Send'}
          >
            <Feather
              name={app.busy ? 'square' : 'arrow-up'}
              size={18}
              color={app.busy || (ready && input.trim()) ? colors.primaryForeground : colors.mutedForeground}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  logo: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  logoCore: { width: 8, height: 8, borderRadius: 4 },
  headerText: { flex: 1, minWidth: 0 },
  brand: { fontSize: 16.5, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  setupCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 24 },
  setupTitle: { fontSize: 20, fontWeight: '700' },
  setupBtn: { alignSelf: 'flex-start', marginTop: 14, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  welcomeTitle: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  example: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, maxHeight: 160, fontSize: 16 },
  send: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
