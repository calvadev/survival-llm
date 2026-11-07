/**
 * On-device inference and the chat loop — a TypeScript port of the essentials of
 * core.py: the same system prompt, the same library tools (search_library,
 * read_article, show_article), the same "base answers on the library and name
 * your sources" discipline, and the same authoritative Sources line.
 *
 * The engine is llama.rn (llama.cpp). It is a native module, so it is only
 * available in the installed Android app, not in Expo Go — engineAvailable()
 * reports that, and the rest of the app degrades gracefully.
 */
import { router } from 'expo-router';
import { Library, TOPICS } from './library';

export interface Source {
  id: number;
  title: string;
  source: string;
  official: boolean;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ---- prompts, ported verbatim in substance from core.py ----

const BASE_PROMPT =
  'You are an offline assistant running entirely on this phone, with no internet access: ' +
  "you can't go online, call or contact anyone for the person. The person asking may be dealing " +
  'with a power outage or another emergency, possibly running on battery.';

const LIBRARY_PROMPT =
  '\n\nYou have an offline library: search it with search_library and read results with read_article. ' +
  "The ids are for your tools; don't show them to the person. It holds: {labels}. If the person asks " +
  'to see a source or the full instructions, open it for them with show_article.';

const RULES =
  '\n\nHow to answer:' +
  '\n- {search_rule}' +
  '\n- Lead with the direct answer, then short numbered steps when steps help.' +
  '\n- Put safety first. Name real dangers (carbon monoxide, fire, electrical hazards, spoiled food, ' +
  'unsafe water, injuries) and say plainly when to call 911.' +
  '\n- Carbon monoxide kills people in every blackout. Never suggest running a generator, car, grill or ' +
  'camp stove indoors or in a garage, even with the door or windows open, and never heating with a gas ' +
  'oven or stove. Heaters must be made for indoor use, with a working CO alarm. Give no "if you must" ' +
  'exceptions to these.' +
  '\n- Always answer. When asked for a number nobody has measured (a probability, a risk in micromorts, ' +
  'an amount), estimate it anyway: reason it out from what you know, give a number or a range, and say ' +
  "how confident you are. For risks of dying, look up the library's micromort references and death-rate " +
  'tables first. Missing data is never a reason to withhold a number. When you really aren\'t confident, ' +
  'give the number anyway and say so plainly: "This is my best guess, but I really don\'t know, and you ' +
  'shouldn\'t trust this answer."' +
  '\n- When you can\'t back an answer with the library, answer anyway from what you know, or make something ' +
  'up if you have to, as long as you say so plainly ("From what I know:" or "I\'m guessing here:"). Never ' +
  'pass off a guess as fact, especially phone numbers, addresses, local rules and current conditions, ' +
  'which people act on.' +
  '\n- Don\'t add disclaimers like "I\'m not a doctor" or "consult a professional"; the app already says ' +
  'AI can make mistakes. Do say when someone needs emergency help now.{sources_rule}' +
  '\n- Keep answers short to save battery unless asked for more detail.';

const SEARCH_RULE =
  'Before answering any factual, medical, safety or how-to question, search the library, even if you ' +
  'think you know the answer, so the person can check where it came from. Try a second wording if the ' +
  'first misses, read the one or two most relevant results, and base your answer on them. If nothing relevant turns ' +
  'up, still answer. When sources disagree, trust Ready.gov, CDC, MedlinePlus, the UK medicines guide, ' +
  'WikEM and WikiMed over wikiHow and Q&A sites.';

const SOURCES_RULE =
  '\n- End with one short line, "Sources:", naming the articles you used. The app also shows the person ' +
  'every article you opened, so name only articles you actually read, and never make one up. If you ' +
  'answered from what you already know, write "Sources: none (from my own knowledge)".';

const FINAL_NUDGE =
  '(Note from the app, not the person: you have used all your library lookups. Answer the question now ' +
  'from what you already read, and list your sources. Do not call any more tools.)';

const MAX_TOOL_ROUNDS = 4;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_library',
      description:
        'Keyword search over the offline library. Returns the best-matching passages, each with an id ' +
        'for read_article. Use a few specific keywords, not a full sentence.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "Keywords, e.g. 'generator carbon monoxide garage'" },
          topic: { type: 'string', enum: ['any', ...TOPICS], description: 'Optional: only search one kind of source' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_article',
      description:
        "Read about 5,000 characters of an article, starting at a search result's passage. " +
        'Read the one or two most relevant results, not all of them.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'The id from search_library' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_article',
      description:
        "Open an article on the person's screen so they can read it themselves, scrolled to the passage " +
        'with this id. Use ONLY when the person explicitly asks to see a source or the full instructions — ' +
        'never to read an article yourself (use read_article for that). At most one per answer.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'The id from search_library or read_article' } },
        required: ['id'],
      },
    },
  },
];

// ---- engine lifecycle ----

let llama: any = null;
let tried = false;

export function engineAvailable(): boolean {
  if (!tried) {
    tried = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      llama = require('llama.rn');
    } catch {
      llama = null; // Expo Go / web: no native llama.cpp
    }
  }
  return !!llama;
}

let ctx: any = null;
let loadedPath: string | null = null;

export function modelLoaded(): boolean {
  return !!ctx;
}

export async function loadModel(path: string): Promise<void> {
  if (ctx && loadedPath === path) return;
  await unloadModel();
  if (!engineAvailable()) throw new Error('preview');
  ctx = await llama.initLlama({
    model: path.replace(/^file:\/\//, ''),
    n_ctx: 8192,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
  });
  loadedPath = path;
}

export async function unloadModel(): Promise<void> {
  if (ctx) {
    try {
      await ctx.release();
    } catch {
      // already gone
    }
  }
  ctx = null;
  loadedPath = null;
}

export async function stopAnswer(): Promise<void> {
  try {
    await ctx?.stopCompletion();
  } catch {
    // not answering
  }
}

// ---- the chat turn ----

interface RunParams {
  library: Library | null;
  labels: string[];
  history: HistoryMessage[];
  question: string;
  onToken: (text: string) => void;
  onActivity: (line: string) => void;
}

function systemPrompt(labels: string[], tools: boolean): string {
  if (!labels.length) {
    return (
      BASE_PROMPT +
      RULES.replace('{search_rule}', 'Answer from what you know; you cannot look anything up.').replace(
        '{sources_rule}',
        '\n- Do not cite sources you cannot check.',
      )
    );
  }
  if (!tools) {
    return (
      BASE_PROMPT +
      RULES.replace(
        '{search_rule}',
        'Library excerpts may be attached to the question; base your answer on them when relevant.',
      ).replace(
        '{sources_rule}',
        '\n- End with one short line, "Sources:", naming the excerpts you used, or "Sources: none (from my ' +
          'own knowledge)" if none of them helped. The person sees the excerpts too, so never name anything else.',
      )
    );
  }
  return (
    BASE_PROMPT +
    LIBRARY_PROMPT.replace('{labels}', labels.join(', ')) +
    RULES.replace('{search_rule}', SEARCH_RULE).replace('{sources_rule}', SOURCES_RULE)
  );
}

function parseArgs(call: any): Record<string, any> {
  let args = call?.function?.arguments ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args || '{}');
    } catch {
      args = {};
    }
  }
  return typeof args === 'object' && args ? args : {};
}

const SOURCES_TAIL = /\n{0,2}[*#_ ]*Sources?[*_ ]*:[^\n]*(\n|$)/i;

// The model can flood a round with calls (one answer tried 17); each read is
// ~5,000 characters and the context window is 8,192 tokens, so cap a round.
const MAX_CALLS_PER_ROUND = 4;

// Models sometimes write tool calls as text instead of using the template's
// mechanism — Llama 3.2 writes bare {"name": ..., "parameters": {...}} lines,
// some models wrap the same JSON in <tool_call>...</tool_call>. Recover those
// calls and keep the markup off the screen; core.py does the same dance.
const TEXT_CALL =
  /(?:<tool_call>\s*)?\{\s*["']name["']\s*:\s*["'](search_library|read_article|show_article)["']\s*,\s*["'](?:parameters|arguments)["']\s*:\s*\{[^{}]*\}\s*\}\s*(?:<\/tool_call>)?/g;
// The same JSON shape naming something that is not a tool (models hallucinate
// a "Sources" tool): never executed, but still stripped from the answer.
const TEXT_CALL_ANY =
  /(?:<tool_call>\s*)?\{\s*["']name["']\s*:\s*["'][A-Za-z_]+["']\s*,\s*["'](?:parameters|arguments)["']\s*:\s*\{[^{}]*\}\s*\}\s*(?:<\/tool_call>)?/g;
// An answer that IS tool-call markup (parsed or not) is not an answer.
const MARKUP_START = /^\s*(<tool_call|<\/?function|\{\s*["']name["']\s*:)/;
const MARKUP_PREFIXES = ['<tool_call', '<function', '{"name"', '{ "name"', "{'name'"];

/** Pull text-written tool calls out of a completion; returns the calls and the text without any call markup. */
function extractTextCalls(text: string): { calls: any[]; cleaned: string } {
  const calls: any[] = [];
  for (const m of text.matchAll(TEXT_CALL)) {
    let params: Record<string, any> = {};
    const pm = m[0].match(/["'](?:parameters|arguments)["']\s*:\s*(\{[^{}]*\})/);
    if (pm) {
      try {
        params = JSON.parse(pm[1].replace(/'/g, '"'));
      } catch {
        params = {};
      }
    }
    calls.push({ type: 'function', function: { name: m[1], arguments: JSON.stringify(params) } });
  }
  const cleaned = text
    .replace(TEXT_CALL_ANY, ' ')
    .replace(/<\/?tool_call>/g, ' ')
    .replace(/^[ \t]*;[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { calls, cleaned };
}

/**
 * Run one turn: stream the answer, run the model's library tool calls, and end
 * with the authoritative Sources line (what it actually read), exactly as the
 * desktop app does.
 */
export async function chatTurn(params: RunParams): Promise<{ text: string; sources: Source[] }> {
  const { library, labels, history, question, onToken, onActivity } = params;
  if (!ctx) throw new Error('The AI is not loaded yet.');
  const sources = new Map<number, Source>();
  const knownIds = new Set<number>();
  const messages: any[] = [
    { role: 'system', content: systemPrompt(labels, !!library) },
    ...history.slice(-10),
    { role: 'user', content: question },
  ];

  let useTools = !!library;
  let answer = '';
  let shownOnScreen = 0;

  // The model/template can't do tool calls (or keeps writing them as text):
  // fall back to attaching excerpts to the question. Rebuild the transcript
  // from scratch — assistant/tool messages from the failed rounds must not
  // linger, or the retry fails on the same messages.
  const fallbackToExcerpts = async () => {
    useTools = false;
    messages.length = 0;
    messages.push(
      { role: 'system', content: systemPrompt(labels, false) },
      ...history.slice(-10),
      { role: 'user', content: question },
    );
    const excerpts: string[] = [];
    for (const hit of await library!.search(question, undefined, 4)) {
      const doc = await library!.read(hit.id, 2500);
      if (doc) {
        sources.set(hit.id, { id: hit.id, title: hit.title, source: hit.source, official: hit.official });
        excerpts.push(`[${doc.title} (${doc.source})]\n${doc.text}`);
        onActivity(`Read “${doc.title}” (${doc.source})`);
      }
    }
    if (excerpts.length) {
      messages[messages.length - 1] = {
        role: 'user',
        content: question + '\n\nLibrary excerpts:\n\n' + excerpts.join('\n\n'),
      };
    }
  };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const last = round === MAX_TOOL_ROUNDS;
    if (last) messages.push({ role: 'user', content: FINAL_NUDGE });
    const body: any = {
      messages,
      n_predict: 2048,
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
    };
    if (useTools && !last) {
      body.tools = TOOLS;
      body.jinja = true;
      body.tool_choice = 'auto';
    }
    let result: any;
    let streamed = '';
    let shownUpTo = 0;
    try {
      result = await ctx.completion(body, (data: any) => {
        if (!data?.token) return;
        streamed += data.token;
        if (!useTools) {
          onToken(data.token);
          return;
        }
        // Keep tool-call markup off the screen (core.py's held-token dance):
        // hold back text that may still turn out to be the start of a call,
        // and never show text that is one.
        const trimmed = streamed.replace(/^\s+/, '');
        if (MARKUP_PREFIXES.some((p) => trimmed.startsWith(p) || p.startsWith(trimmed))) return;
        if (streamed.length > shownUpTo) {
          onToken(streamed.slice(shownUpTo));
          shownUpTo = streamed.length;
        }
      });
    } catch (err: any) {
      if (useTools) {
        await fallbackToExcerpts();
        round = -1; // the fallback replaces this round rather than consuming one
        continue;
      }
      throw err;
    }
    let calls: any[] = (result?.tool_calls ?? []).slice(0, MAX_CALLS_PER_ROUND);
    let content: string = result?.content ?? result?.text ?? streamed;
    if (useTools && content) {
      const found = extractTextCalls(content);
      // The engine parsed no calls, but the model wrote them as text
      // (Llama 3.2's bare {"name": ..., "parameters": ...} JSON): run them.
      if (!last && !calls.length && found.calls.length) calls = found.calls.slice(0, MAX_CALLS_PER_ROUND);
      content = found.cleaned;
    }
    if (useTools && library && !calls.length && (!content.trim() || MARKUP_START.test(content))) {
      // Its whole answer was tool-call markup the engine never parsed (or the
      // answer was empty): treat it as a tool failure and answer with excerpts.
      await fallbackToExcerpts();
      round = -1; // the fallback replaces this round rather than consuming one
      continue;
    }
    if (!useTools || !calls.length) {
      answer = content;
      break;
    }
    // Rebuild the tool calls with guaranteed-string fields before they go back
    // into the transcript: llama.rn can return a call whose id or name is null,
    // and llama.cpp's message parser aborts the whole next completion with
    // "type must be string, but is null" when a present field is null.
    const safeCalls = calls.map((c: any) => {
      const fn = c?.function ?? {};
      const clean: any = {
        type: 'function',
        function: {
          name: typeof fn.name === 'string' ? fn.name : '',
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        },
      };
      if (typeof c?.id === 'string' && c.id) clean.id = c.id;
      return clean;
    });
    messages.push({ role: 'assistant', content: content || '', tool_calls: safeCalls });
    for (const call of calls) {
      const name = call?.function?.name ?? '';
      const args = parseArgs(call);
      let out = '';
      try {
        if (name === 'search_library' && library) {
          const q = String(args.query ?? '');
          const hits = await library.search(q, args.topic || 'any');
          onActivity(`Searched the library for “${q}”`);
          for (const h of hits) knownIds.add(h.id);
          out = hits.length
            ? hits.map((h) => `[id ${h.id}] ${h.title} (${h.source})\n${h.snippet}`).join('\n\n')
            : 'No results. Try different or fewer keywords.';
        } else if ((name === 'read_article' || name === 'show_article') && library) {
          const id = Number(args.id);
          if (!Number.isFinite(id) || !knownIds.has(id)) {
            out = 'No search result has that id. Use an id from your search_library results, or answer from what you have.';
          } else {
            const doc = await library.read(id);
            if (!doc) {
              out = 'No passage with that id.';
            } else {
              sources.set(id, { id, title: doc.title, source: doc.source, official: doc.official });
              if (name === 'show_article' && shownOnScreen === 0) {
                shownOnScreen++;
                onActivity(`Opened “${doc.title}” on screen`);
                router.push({ pathname: '/article', params: { id: String(id) } });
                out = `Opened "${doc.title}" (${doc.source}) on screen.`;
              } else {
                // show_article past the one-per-answer cap lands here too: the
                // screen can't show more, so serve it as a normal read and the
                // model still gets the text it was after.
                onActivity(`Read “${doc.title}” (${doc.source})`);
                out = `${doc.title} (${doc.source})\n${doc.url ?? ''}\n\n${doc.text}`;
              }
            }
          }
        } else {
          out = `Unknown tool ${name}`;
        }
      } catch (err: any) {
        out = `The tool failed: ${err?.message ?? String(err)}`;
      }
      messages.push({ role: 'tool', name, content: out });
    }
  }

  // The authoritative Sources line replaces whatever the model wrote (core.py:
  // models name sources they never opened, so the app states what it really read).
  answer = answer.replace(SOURCES_TAIL, '\n').trimEnd();
  const read = [...sources.values()];
  const line = read.length
    ? 'Sources: ' + read.slice(0, 6).map((s) => `${s.title} (${s.source})`).join('; ')
    : 'Sources: none (from its own knowledge)';
  // The verified line is part of the answer text, exactly as the desktop app shows it.
  return { text: `${answer}\n\n${line}`, sources: read.length ? read : [] };
}
