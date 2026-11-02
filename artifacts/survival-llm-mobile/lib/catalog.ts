/**
 * The downloadable content catalog: AI models (GGUF, run by llama.cpp on-device)
 * and the library packs (the same packs the desktop app installs, from
 * docs/library-packs.json, fetched from the project's Pages site with a bundled
 * fallback so first setup always has the Essentials pack's checksum).
 */

export interface ModelInfo {
  key: string;
  name: string;
  maker: string;
  blurb: string;
  file: string; // file name on disk
  url: string;
  bytes: number;
  gb: string;
  minRamGB: number;
  recommended?: boolean;
  /** Published sha256 (Hugging Face LFS etag). Absent for user-supplied URLs,
   *  which are checked for the GGUF magic instead. */
  sha256?: string;
}

// ~3B-class quantized GGUFs small enough for phones. Downloads are resumable
// and verified against the published checksums below.
export const MODELS: ModelInfo[] = [
  {
    key: 'llama-3.2-3b-q4km',
    name: 'Llama 3.2 3B',
    maker: 'Meta',
    blurb: 'Best balance for a phone: careful answers, follows instructions, cites sources well.',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    bytes: 2019377696,
    gb: '2.0 GB',
    minRamGB: 4,
    recommended: true,
    sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
  },
  {
    key: 'qwen2.5-1.5b-q4km',
    name: 'Qwen 2.5 1.5B',
    maker: 'Alibaba',
    blurb: 'Lighter and faster on older phones, but answers less carefully. Check sources closely.',
    file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    bytes: 986048768,
    gb: '1.0 GB',
    minRamGB: 3,
    sha256: '1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370',
  },
];

export interface PackPart {
  url: string;
  bytes: number;
  sha256: string;
}

export interface PackInfo {
  id: string;
  label: string;
  gb: number;
  articles: number;
  version: string;
  install_bytes: number;
  parts: PackPart[];
  notes?: string;
}

export const PACKS_URL = 'https://calvadev.github.io/survival-llm/library-packs.json';

// Bundled fallback for the Essentials (lite) pack — the same record as
// docs/library-packs.json at the workspace root — so setup works even if the
// pack list can't be fetched. The full pack (8.7 GB) is desktop-class and is
// only offered when the live list is reachable.
export const FALLBACK_PACKS: PackInfo[] = [
  {
    id: 'lite',
    label: 'Essentials: medical, emergency, survival, how-to and repair',
    gb: 1.3,
    articles: 494574,
    version: '2026-10-28',
    install_bytes: 4509641710,
    parts: [
      {
        url: 'https://github.com/anonnerdfrenzy/survival-llm/releases/download/library-2026-10-28/library-lite.zip.000',
        bytes: 1275477229,
        sha256: '0e9fc46df8288c1aa9a81b87386acd224963b8a1b2fd44d51078089d3dee8686',
      },
    ],
    notes: 'Medical, emergency, survival and how-to articles, without Wikipedia and iFixit.',
  },
];

export async function fetchPacks(): Promise<{ packs: PackInfo[]; live: boolean }> {
  try {
    const resp = await fetch(PACKS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const packs = Array.isArray(data?.packs) ? (data.packs as PackInfo[]) : [];
    if (!packs.length) throw new Error('empty pack list');
    return { packs, live: true };
  } catch {
    return { packs: FALLBACK_PACKS, live: false };
  }
}
