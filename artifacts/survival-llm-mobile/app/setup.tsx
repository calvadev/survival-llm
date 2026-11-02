/**
 * First-run setup: pick the library and an AI model, one download that resumes
 * if it's interrupted — the desktop app's one-screen setup, mobile-sized.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FALLBACK_PACKS, fetchPacks, MODELS, PackInfo } from '@/lib/catalog';
import { gb } from '@/lib/fsutil';
import { Job } from '@/lib/install';
import { useApp } from '@/lib/state';

function Option({
  on,
  title,
  meta,
  about,
  disabled,
  onPress,
}: {
  on: boolean;
  title: string;
  meta?: string;
  about?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.option,
        { borderColor: on ? colors.primary : colors.border, backgroundColor: colors.card, opacity: disabled ? 0.55 : 1 },
        on && { borderWidth: 2 },
      ]}
    >
      <View style={[styles.radio, { borderColor: on ? colors.primary : colors.mutedForeground }]}>
        {on && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15.5 }}>
          {title} {meta ? <Text style={{ color: colors.mutedForeground, fontWeight: '400' }}>{meta}</Text> : null}
        </Text>
        {!!about && <Text style={{ color: colors.mutedForeground, fontSize: 13.5, marginTop: 3, lineHeight: 19 }}>{about}</Text>}
      </View>
    </Pressable>
  );
}

function JobView({ job }: { job: Job }) {
  const colors = useColors();
  const pct = job.total ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0;
  const line =
    job.status === 'verifying'
      ? 'Checking the download…'
      : job.status === 'unpacking'
        ? 'Unpacking… (a few minutes)'
        : job.status === 'paused'
          ? 'Paused'
          : job.status === 'error'
            ? ''
            : job.total
              ? `${gb(job.completed)} of ${gb(job.total)}`
              : 'Starting…';
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{job.label}</Text>
      {job.status === 'error' ? (
        <Text style={{ color: colors.destructive, marginTop: 4, lineHeight: 20 }}>{job.error}</Text>
      ) : (
        <>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 3 }}>{line}</Text>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${pct}%` }]} />
          </View>
        </>
      )}
    </View>
  );
}

export default function SetupScreen() {
  const colors = useColors();
  const router = useRouter();
  const app = useApp();
  const [packs, setPacks] = useState<PackInfo[]>(FALLBACK_PACKS);
  const [packId, setPackId] = useState('lite');
  const [modelKey, setModelKey] = useState(MODELS[0].key);
  const [customUrl, setCustomUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  useEffect(() => {
    fetchPacks().then(({ packs: live }) => setPacks(live)).catch(() => {});
  }, []);

  const needLibrary = !app.libraryInfo;
  const needModel = !app.model;
  const pack = packs.find((p) => p.id === packId) ?? packs[0];
  const model = MODELS.find((m) => m.key === modelKey);
  const custom = modelKey === 'custom';
  const totalGB = (needLibrary ? pack?.gb ?? 0 : 0) + (needModel && !custom ? model?.bytes ?? 0 : 0) / 1e9;
  // Library bar always first, model bar always second (sort is stable, so a
  // progress update never makes the bars trade places).
  const jobOrder = (j: Job) => (j.key.startsWith('library:') ? 0 : j.key.startsWith('model:') ? 1 : 2);
  const activeJobs = app.jobs
    .filter((j) => ['downloading', 'verifying', 'unpacking', 'paused', 'error'].includes(j.status))
    .sort((a, b) => jobOrder(a) - jobOrder(b));
  const running = activeJobs.some((j) => j.status !== 'error');
  const done = !needLibrary && !needModel;

  const canStart =
    !starting && !running && (needLibrary || needModel) && (!custom || customUrl.trim().startsWith('http'));

  const start = async () => {
    setStarting(true);
    setStartError('');
    try {
      const tasks: Promise<void>[] = [];
      if (needLibrary && pack) tasks.push(app.startLibraryDownload(pack));
      if (needModel) tasks.push(app.startModelDownload(modelKey, customUrl.trim()));
      await Promise.all(tasks);
    } catch (err: any) {
      setStartError(err?.message ?? String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} style={{ backgroundColor: colors.background }}>
      <Text style={[styles.h1, { color: colors.text }]}>Set up Survival LLM</Text>
      <Text style={{ color: colors.mutedForeground, lineHeight: 21, marginTop: 6 }}>
        Survival LLM is an AI that runs on this phone. It answers from an offline library of medical,
        emergency and how-to articles, and shows you where each answer came from. Download both once, while
        you have internet; after that it works with none. If a download is interrupted, it picks up where it
        left off the next time you open the app.
      </Text>

      {needLibrary && (
        <View style={[styles.part, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.partTitle, { color: colors.text }]}>1 · The library</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13.5, marginTop: 2 }}>
            What the AI looks things up in. You can read it yourself, too.
          </Text>
          <View style={{ marginTop: 10, gap: 8 }}>
            {packs.map((p) => (
              <Option
                key={p.id}
                on={p.id === packId}
                title={p.id === 'lite' ? 'Essentials' : 'Everything'}
                meta={`${p.gb} GB`}
                about={
                  p.id === 'lite'
                    ? `${p.label.split(': ')[1] ?? p.label}. ${p.articles.toLocaleString()} articles. The right size for a phone.`
                    : `${p.label.split(': ')[1] ?? p.label}. Desktop-class — only with plenty of free space.`
                }
                onPress={() => setPackId(p.id)}
              />
            ))}
          </View>
        </View>
      )}

      {needModel && (
        <View style={[styles.part, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.partTitle, { color: colors.text }]}>2 · The AI</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13.5, marginTop: 2 }}>
            Runs on this phone and writes the answers. Bigger ones know more and make fewer mistakes.
          </Text>
          <View style={{ marginTop: 10, gap: 8 }}>
            {MODELS.map((m) => (
              <Option
                key={m.key}
                on={m.key === modelKey}
                title={m.name}
                meta={m.gb}
                about={`${m.blurb} · by ${m.maker}`}
                onPress={() => setModelKey(m.key)}
              />
            ))}
            <Option
              on={custom}
              title="A model of your own"
              meta="GGUF"
              about="Paste the address of a quantized GGUF file (small, instruct-tuned models work best)."
              onPress={() => setModelKey('custom')}
            />
            {custom && (
              <TextInput
                value={customUrl}
                onChangeText={setCustomUrl}
                placeholder="https://…/model-Q4_K_M.gguf"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.urlInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.text }]}
              />
            )}
          </View>
        </View>
      )}

      {activeJobs.map((j) => (
        <JobView key={j.key} job={j} />
      ))}
      {!!startError && <Text style={{ color: colors.destructive, marginTop: 12, lineHeight: 20 }}>{startError}</Text>}

      {done ? (
        <View style={{ marginTop: 20 }}>
          <Text style={{ color: colors.ok, fontWeight: '700', fontSize: 16 }}>✓ Setup is done. Survival LLM now works without internet.</Text>
          <Pressable onPress={() => router.back()} style={[styles.go, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 16 }}>Start asking</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => void start()}
          disabled={!canStart}
          style={[styles.go, { backgroundColor: canStart ? colors.primary : colors.border }]}
        >
          {starting || running ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={{ color: canStart ? colors.primaryForeground : colors.mutedForeground, fontWeight: '700', fontSize: 16 }}>
              {activeJobs.some((j) => j.status === 'error') ? 'Try again' : `Download${totalGB ? ` ${totalGB.toFixed(1)} GB` : ''}`}
            </Text>
          )}
        </Pressable>
      )}
      <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 12, lineHeight: 19 }}>
        Keep the app open while it downloads. Everything is saved on this phone; nothing about you is sent anywhere.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: '700' },
  part: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 16 },
  partTitle: { fontSize: 17, fontWeight: '700' },
  option: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: 11, padding: 12, alignItems: 'flex-start' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, marginTop: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  urlInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  progressTrack: { height: 8, borderRadius: 4, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  go: { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
});
