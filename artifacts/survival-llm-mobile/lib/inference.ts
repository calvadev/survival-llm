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
  'first misses, read the most relevant result, and base your answer on it. If nothing relevant turns ' +
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
      description: "Read about 5,000 characters of an article, starting at a search result's passage.",
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
        'with this id. Use when they ask to see the source or the full instructions.',
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
    try {
      result = await ctx.completion(body, (data: any) => {
        if (data?.token) {
          streamed += data.token;
          onToken(data.token);
        }
      });
    } catch (err: any) {
      if (useTools) {
        // The model/template can't do tool calls: fall back to attaching excerpts.
        useTools = false;
        messages[0] = { role: 'system', content: systemPrompt(labels, false) };
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
        continue;
      }
      throw err;
    }
    const calls: any[] = result?.tool_calls ?? [];
    const content: string = result?.content ?? result?.text ?? streamed;
    if (!useTools || !calls.length) {
      answer = content || streamed;
      break;
    }
    messages.push({ role: 'assistant', content: content || '', tool_calls: calls });
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
              if (name === 'show_article') {
                onActivity(`Opened “${doc.title}” on screen`);
                router.push({ pathname: '/article', params: { id: String(id) } });
                out = `Opened "${doc.title}" (${doc.source}) on screen.`;
              } else {
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
