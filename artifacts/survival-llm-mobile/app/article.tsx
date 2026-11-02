/**
 * The reader: the whole article a source came from, with the cited passage
 * highlighted — the desktop reader pane as a screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { DocumentView, Library } from '@/lib/library';

export default function ArticleScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [missing, setMissing] = useState(false);
  const scrollRef = useRef<any>(null);
  const focusY = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const lib = await Library.open();
      const d = lib ? await lib.document(Number(id)) : null;
      if (!live) return;
      if (d) setDoc(d);
      else setMissing(true);
    })();
    return () => {
      live = false;
    };
  }, [id]);

  if (missing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>This article isn't in the installed library.</Text>
      </View>
    );
  }
  if (!doc) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: colors.card }}
      contentContainerStyle={{ padding: 18, paddingBottom: 60 }}
      onContentSizeChange={() => {
        if (focusY.current != null) scrollRef.current?.scrollTo({ y: Math.max(0, focusY.current - 24), animated: false });
      }}
    >
      <Text style={[styles.title, { color: colors.text }]}>{doc.title}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13.5, marginTop: 4 }}>
        {doc.source}
        {doc.official ? ' · Official' : ''}
      </Text>
      {!!doc.license && (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 3, lineHeight: 17 }}>{doc.license}</Text>
      )}
      <View style={{ marginTop: 14 }}>
        {doc.parts.map((p) => {
          const cited = p.id === doc.focus;
          return (
            <View
              key={p.id}
              onLayout={
                cited
                  ? (e) => {
                      focusY.current = e.nativeEvent.layout.y;
                    }
                  : undefined
              }
              style={[
                styles.part,
                cited && {
                  backgroundColor: colors.cite,
                  borderLeftColor: colors.citeLine,
                  borderLeftWidth: 3,
                  borderRadius: 4,
                },
              ]}
            >
              {cited && (
                <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>
                  CITED IN THE ANSWER
                </Text>
              )}
              <Text style={{ color: colors.text, lineHeight: 22, fontSize: 15 }}>{p.text}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '700', lineHeight: 27 },
  part: { paddingHorizontal: 10, paddingVertical: 8, marginHorizontal: -10 },
});
