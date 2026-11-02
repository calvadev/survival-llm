/**
 * Search the library yourself — the reader's search half, as its own screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { Library, SearchHit } from '@/lib/library';

export default function LibraryScreen() {
  const colors = useColors();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const libRef = useRef<Library | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    Library.open().then((lib) => {
      libRef.current = lib;
    });
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults(null);
      return;
    }
    const req = ++reqRef.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const hits = (await libRef.current?.search(q)) ?? [];
        if (req === reqRef.current) setResults(hits);
      } finally {
        if (req === reqRef.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.searchRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search the library yourself…"
          placeholderTextColor={colors.mutedForeground}
          autoFocus
          autoCapitalize="none"
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
        />
        {searching && <ActivityIndicator color={colors.primary} size="small" />}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        {results === null ? (
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>
            Search every article in the offline library — medical, emergency, how-to and more — and read any of
            them here.
          </Text>
        ) : results.length === 0 ? (
          <Text style={{ color: colors.mutedForeground }}>No results. Try different or fewer keywords.</Text>
        ) : (
          results.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => router.push({ pathname: '/article', params: { id: String(r.id) } })}
              style={[styles.result, { borderBottomColor: colors.border }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15.5, flexShrink: 1 }}>{r.title}</Text>
                {r.official && (
                  <View style={[styles.official, { borderColor: colors.official }]}>
                    <Text style={{ color: colors.official, fontSize: 10, fontWeight: '700' }}>OFFICIAL</Text>
                  </View>
                )}
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 12.5, marginTop: 1 }}>{r.source}</Text>
              <Text numberOfLines={3} style={{ color: colors.mutedForeground, fontSize: 13.5, marginTop: 3, lineHeight: 19 }}>
                {r.snippet}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16 },
  result: { paddingVertical: 12, borderBottomWidth: 1 },
  official: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
});
