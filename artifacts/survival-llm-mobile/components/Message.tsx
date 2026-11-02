/**
 * One chat message: the desktop app's look (plain assistant answers on the
 * page background, right-aligned warm bubble for the person's questions),
 * with its activity log, a "Show reasoning" disclosure, and source chips.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ChatMessage } from '@/lib/state';

/** A tiny Markdown subset, mirroring app/static/app.js's renderer: paragraphs,
 *  - bullets, 1. lists, **bold**, *italic*, `code`, ### headings. */
function Md({ text, color }: { text: string; color: string }) {
  const colors = useColors();
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushList = (key: string) => {
    if (!list) return;
    blocks.push(
      <View key={key} style={{ marginBottom: 10, paddingLeft: 6 }}>
        {list.items.map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }}>
            <Text style={{ color, width: 18 }}>{list!.ordered ? `${i + 1}.` : '•'}</Text>
            <Text style={{ color, flex: 1, lineHeight: 24 }}>{inline(item, color, colors.userBubble)}</Text>
          </View>
        ))}
      </View>,
    );
    list = null;
  };
  const lines = text.split('\n');
  let para: string[] = [];
  const flushPara = (key: string) => {
    if (!para.length) return;
    blocks.push(
      <Text key={key} style={{ color, lineHeight: 24, marginBottom: 10 }}>
        {inline(para.join(' '), color, colors.userBubble)}
      </Text>,
    );
    para = [];
  };
  lines.forEach((line, i) => {
    const h = line.match(/^(#{1,6})\s+(.*)/);
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (h) {
      flushPara(`p${i}`);
      flushList(`l${i}`);
      blocks.push(
        <Text key={`h${i}`} style={{ color, fontWeight: '700', fontSize: 16, marginTop: 8, marginBottom: 4 }}>
          {h[2]}
        </Text>,
      );
    } else if (ul) {
      flushPara(`p${i}`);
      if (!list || list.ordered) {
        flushList(`l${i}`);
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
    } else if (ol) {
      flushPara(`p${i}`);
      if (!list || !list.ordered) {
        flushList(`l${i}`);
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[2]);
    } else if (!line.trim()) {
      flushPara(`p${i}`);
      flushList(`l${i}`);
    } else {
      para.push(line.trim());
    }
  });
  flushPara('pend');
  flushList('lend');
  return <View>{blocks}</View>;
}

function inline(text: string, color: string, codeBg: string): React.ReactNode[] {
  // **bold** and `code` spans.
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<Text key={k++} style={{ fontWeight: '700' }}>{tok.slice(2, -2)}</Text>);
    else if (tok.startsWith('`'))
      out.push(
        <Text key={k++} style={{ fontFamily: 'monospace', backgroundColor: codeBg, fontSize: 14 }}>
          {tok.slice(1, -1)}
        </Text>,
      );
    else out.push(<Text key={k++} style={{ fontStyle: 'italic' }}>{tok.slice(1, -1)}</Text>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MessageBubble({ msg }: { msg: ChatMessage }) {
  const colors = useColors();
  const [showReasoning, setShowReasoning] = useState(false);

  if (msg.role === 'user') {
    return (
      <View style={[styles.row, { justifyContent: 'flex-end' }]}>
        <View style={[styles.userBubble, { backgroundColor: colors.userBubble }]}>
          <Text style={{ color: colors.text, lineHeight: 23 }}>{msg.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.answer}>
      {msg.activity.length > 0 && (
        <View style={{ marginBottom: 6 }}>
          {msg.activity.map((line, i) => (
            <Text key={i} style={{ color: colors.mutedForeground, fontSize: 13.5, paddingVertical: 1 }}>
              {line}
            </Text>
          ))}
        </View>
      )}
      {msg.text ? (
        <Md text={msg.text} color={msg.error ? colors.destructive : colors.text} />
      ) : msg.pending ? (
        <Text style={{ color: colors.mutedForeground }}>▍</Text>
      ) : null}
      {msg.pending && !!msg.text && <Text style={{ color: colors.primary }}>▍</Text>}

      {!msg.pending && (msg.activity.length > 0) && (
        <Pressable onPress={() => setShowReasoning((v) => !v)} hitSlop={8}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 6, textDecorationLine: 'underline' }}>
            {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
          </Text>
        </Pressable>
      )}
      {showReasoning && (
        <View style={[styles.reasoning, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13.5, marginBottom: 6 }}>How it answered</Text>
          {msg.activity.map((line, i) => (
            <View key={i} style={[styles.rRow, { borderTopColor: colors.border, borderTopWidth: i ? 1 : 0 }]}>
              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700', width: 64, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }}>
                step
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, flex: 1, lineHeight: 19 }}>{line}</Text>
            </View>
          ))}
          {msg.activity.length === 0 && (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>It answered directly, without looking anything up.</Text>
          )}
        </View>
      )}

      {msg.sources.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 6 }}>Sources</Text>
          <View style={styles.chips}>
            {msg.sources.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => router.push({ pathname: '/article', params: { id: String(s.id) } })}
                style={({ pressed }) => [
                  styles.chip,
                  { borderColor: pressed ? colors.primary : colors.border, backgroundColor: colors.card },
                ]}
              >
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13.5, flexShrink: 1 }}>
                  {s.title}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}> {s.source}</Text>
                {s.official && (
                  <View style={[styles.official, { borderColor: colors.official }]}>
                    <Text style={{ color: colors.official, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>OFFICIAL</Text>
                  </View>
                )}
                <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 18 },
  userBubble: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' },
  answer: { marginBottom: 18 },
  reasoning: { marginTop: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  rRow: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
  chips: { gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 4,
  },
  official: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginLeft: 4 },
});
