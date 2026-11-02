/**
 * App-wide state: what's installed, what's downloading, and the chat itself.
 * Persisted pieces (installed model, installed library, the conversation) live
 * in AsyncStorage so a restart picks up where things left off.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MODELS, PackInfo } from './catalog';
import {
  chatTurn,
  engineAvailable,
  loadModel,
  modelLoaded,
  Source,
  stopAnswer,
  unloadModel,
} from './inference';
import {
  currentJobs,
  downloadModel,
  downloadPack,
  installedLibraryIndex,
  installedModelPath,
  Job,
  pauseJob,
  removeLibrary,
  removeModel,
  subscribe,
} from './install';
import { Library } from './library';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  activity: string[];
  sources: Source[];
  pending?: boolean;
  error?: boolean;
}

interface InstalledModel {
  key: string;
  file: string;
  custom?: boolean;
  url?: string;
}

interface InstalledLibrary {
  pack: string;
  version: string;
  articles: number;
}

interface AppState {
  loading: boolean;
  engineHere: boolean; // false inside Expo Go / web preview
  model: InstalledModel | null;
  libraryInfo: InstalledLibrary | null;
  jobs: Job[];
  messages: ChatMessage[];
  busy: boolean;
  send: (question: string) => Promise<void>;
  stop: () => Promise<void>;
  newChat: () => void;
  startModelDownload: (modelKey: string, customUrl?: string) => Promise<void>;
  startLibraryDownload: (pack: PackInfo) => Promise<void>;
  pause: (jobKey: string) => Promise<void>;
  forgetModel: () => Promise<void>;
  forgetLibrary: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

const K_MODEL = 'sl:model';
const K_LIBRARY = 'sl:library';
const K_CHAT = 'sl:chat';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<InstalledModel | null>(null);
  const [libraryInfo, setLibraryInfo] = useState<InstalledLibrary | null>(null);
  const [jobs, setJobs] = useState<Job[]>(currentJobs());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const libraryRef = useRef<Library | null>(null);
  const labelsRef = useRef<string[]>([]);

  const refresh = useCallback(async () => {
    // Model: recorded choice whose file must still be on disk.
    let installed: InstalledModel | null = null;
    try {
      const raw = await AsyncStorage.getItem(K_MODEL);
      if (raw) {
        const saved = JSON.parse(raw) as InstalledModel;
        if (installedModelPath(saved.file)) installed = saved;
      }
    } catch {}
    setModel(installed);

    // Library: the index must be on disk; stats come from the index itself.
    let lib: InstalledLibrary | null = null;
    try {
      if (installedLibraryIndex()) {
        libraryRef.current = await Library.open();
        if (libraryRef.current) {
          const stats = await libraryRef.current.stats();
          labelsRef.current = await libraryRef.current.labels();
          const raw = await AsyncStorage.getItem(K_LIBRARY);
          const saved = raw ? (JSON.parse(raw) as InstalledLibrary) : null;
          lib = { pack: saved?.pack ?? 'lite', version: saved?.version ?? '', articles: stats.articles };
        }
      } else {
        libraryRef.current = null;
        labelsRef.current = [];
      }
    } catch {
      libraryRef.current = null;
    }
    setLibraryInfo(lib);
  }, []);

  useEffect(() => {
    const unsub = subscribe((job) => setJobs((prev) => {
      // Replace in place: appending the updated job at the end made progress
      // bars swap positions every tick when two downloads ran at once.
      const idx = prev.findIndex((j) => j.key === job.key);
      if (idx === -1) return [...prev, job];
      const next = prev.slice();
      next[idx] = job;
      return next;
    }));
    (async () => {
      await refresh();
      try {
        const raw = await AsyncStorage.getItem(K_CHAT);
        if (raw) setMessages(JSON.parse(raw));
      } catch {}
      setLoading(false);
    })();
    return unsub;
  }, [refresh]);

  const persistChat = useCallback((msgs: ChatMessage[]) => {
    AsyncStorage.setItem(K_CHAT, JSON.stringify(msgs.slice(-60))).catch(() => {});
  }, []);

  const send = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    const userMsg: ChatMessage = { id: uid(), role: 'user', text, activity: [], sources: [] };
    const botMsg: ChatMessage = { id: uid(), role: 'assistant', text: '', activity: [], sources: [], pending: true };
    setMessages((prev) => {
      const next = [...prev, userMsg, botMsg];
      persistChat(next);
      return next;
    });
    const patchBot = (patch: Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === botMsg.id ? { ...m, ...patch } : m)));

    try {
      if (!engineAvailable()) {
        patchBot({
          pending: false,
          error: true,
          text:
            'In this preview the AI engine is not available — on-device inference runs in the installed ' +
            'Android app. The library search (the magnifier at the top) works here once the library is downloaded.',
        });
        return;
      }
      if (!model) throw new Error('No AI model is downloaded yet. Set one up first.');
      const uri = installedModelPath(model.file);
      if (!uri) throw new Error('The model file is gone from this phone. Download it again from Settings.');
      if (!modelLoaded()) {
        patchBot({ activity: ['Getting the AI ready… (the first answer after opening the app takes a moment)'] });
        await loadModel(uri);
        patchBot({ activity: [] });
      }
      const history = messagesRefToHistory();
      const activity: string[] = [];
      const result = await chatTurn({
        library: libraryRef.current,
        labels: labelsRef.current,
        history,
        question: text,
        onToken: (tok) => patchBot({ text: (latestText(botMsg.id) || '') + tok }),
        onActivity: (line) => {
          activity.push(line);
          patchBot({ activity: [...activity] });
        },
      });
      patchBot({ pending: false, text: result.text, sources: result.sources, activity });
      setMessages((prev) => {
        persistChat(prev);
        return prev;
      });
    } catch (err: any) {
      patchBot({
        pending: false,
        error: true,
        text: `Something went wrong: ${err?.message ?? String(err)}`,
      });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, model, persistChat]);

  // Helpers to read the in-flight message without stale closures.
  const messagesLive = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesLive.current = messages;
  }, [messages]);
  const latestText = (id: string) => messagesLive.current.find((m) => m.id === id)?.text ?? '';
  const messagesRefToHistory = () =>
    messagesLive.current
      .filter((m) => !m.pending && !m.error && m.text)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.text }) as const);

  const stop = useCallback(async () => {
    await stopAnswer();
    setBusy(false);
    setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
  }, []);

  const newChat = useCallback(() => {
    setMessages(() => {
      persistChat([]);
      return [];
    });
  }, [persistChat]);

  const startModelDownload = useCallback(async (modelKey: string, customUrl?: string) => {
    const found = MODELS.find((m) => m.key === modelKey);
    const info = found ?? {
      key: 'custom',
      name: 'Custom model',
      maker: '',
      blurb: '',
      file: 'custom-model.gguf',
      url: customUrl ?? '',
      bytes: 0,
      gb: '',
      minRamGB: 0,
    };
    if (!info.url) throw new Error('No download address for this model.');
    const file = await downloadModel(info);
    await AsyncStorage.setItem(K_MODEL, JSON.stringify({ key: info.key, file, custom: !found, url: info.url }));
    await unloadModel();
    await refresh();
  }, [refresh]);

  const startLibraryDownload = useCallback(async (pack: PackInfo) => {
    await downloadPack(pack);
    await AsyncStorage.setItem(K_LIBRARY, JSON.stringify({ pack: pack.id, version: pack.version, articles: pack.articles }));
    await refresh();
  }, [refresh]);

  const pause = useCallback(async (jobKey: string) => pauseJob(jobKey), []);

  const forgetModel = useCallback(async () => {
    if (model) await removeModel(model.file);
    await unloadModel();
    await AsyncStorage.removeItem(K_MODEL);
    await refresh();
  }, [model, refresh]);

  const forgetLibrary = useCallback(async () => {
    await removeLibrary();
    libraryRef.current = null;
    labelsRef.current = [];
    await AsyncStorage.removeItem(K_LIBRARY);
    await refresh();
  }, [refresh]);

  const value = useMemo<AppState>(() => ({
    loading,
    engineHere: engineAvailable(),
    model,
    libraryInfo,
    jobs,
    messages,
    busy,
    send,
    stop,
    newChat,
    startModelDownload,
    startLibraryDownload,
    pause,
    forgetModel,
    forgetLibrary,
    refresh,
  }), [loading, model, libraryInfo, jobs, messages, busy, send, stop, newChat,
       startModelDownload, startLibraryDownload, pause, forgetModel, forgetLibrary, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
