"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  BellOff,
  Check,
  ChevronDown,
  Contact,
  Copy,
  Download,
  FileText,
  Forward,
  Image as ImageIcon,
  Mic,
  Pause,
  Pin,
  Play,
  Reply,
  SmilePlus,
  Star,
  Trash2,
  UserRound,
  VolumeX,
  X,
} from "lucide-react";
import { CHAT_REACT_EMOJIS } from "@/lib/chatReactions";

export function Toast({ text, onDone }) {
  useEffect(() => {
    if (!text) return undefined;
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg">
      {text}
    </div>
  );
}

export function Lightbox({ item, onClose }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(event) => event.stopPropagation()}>
        <p className="truncate text-sm font-medium">{item.name || "Önizleme"}</p>
        <div className="flex items-center gap-2">
          <a href={item.url} download={item.name || "dosya"} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10" aria-label="İndir">
            <Download size={18} />
          </a>
          <button type="button" aria-label="Kapat" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={onClose}>
        {item.video ? (
          <video src={item.url} controls className="max-h-full max-w-full rounded-lg" onClick={(event) => event.stopPropagation()} />
        ) : (
          <img src={item.url} alt="" className="max-h-full max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
        )}
      </div>
    </div>
  );
}

export function AttachDrawer({ open, onPhotos, onDocs, onContact }) {
  if (!open) return null;
  const items = [
    { label: "Fotoğraflar ve Videolar", icon: ImageIcon, color: "bg-[#007bfc]", onClick: onPhotos },
    { label: "Belge", icon: FileText, color: "bg-[#7f66ff]", onClick: onDocs },
    { label: "Kişi", icon: UserRound, color: "bg-[#009de2]", onClick: onContact },
  ];
  return (
    <div data-chat-pop="" className="absolute bottom-14 left-0 z-20 flex flex-col items-start gap-3 pb-1">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.onClick}
          className="flex items-center gap-3 rounded-full pr-4 text-left shadow-lg"
        >
          <span className={`grid h-12 w-12 place-items-center rounded-full text-white ${item.color}`}>
            <item.icon size={20} />
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function MessageMenu({ mine, open, onReply, onReact, onCopy, onForward, onStar, starred, onDeleteMine, onDeleteEveryone, onClose }) {
  if (!open) return null;
  return (
    <div data-chat-pop="" className={`absolute top-full z-30 mt-1 w-44 overflow-hidden rounded-md bg-white py-1 text-slate-700 shadow-lg ring-1 ring-black/5 ${mine ? "left-0" : "right-0"}`}>
      <MenuItem icon={Reply} label="Yanıtla" onClick={onReply} />
      <MenuItem icon={SmilePlus} label="Reaksiyon ekle" onClick={onReact} />
      <MenuItem icon={Copy} label="Kopyala" onClick={onCopy} />
      <MenuItem icon={Forward} label="İlet" onClick={onForward} />
      <MenuItem icon={Star} label={starred ? "Yıldızı kaldır" : "Yıldızla"} onClick={onStar} />
      {mine ? (
        <>
          <MenuItem icon={Trash2} label="Herkesten sil" danger onClick={onDeleteEveryone} />
          <MenuItem icon={Trash2} label="Benden sil" danger onClick={onDeleteMine} />
        </>
      ) : (
        <MenuItem icon={Trash2} label="Benden sil" danger onClick={onDeleteMine} />
      )}
      <button type="button" className="sr-only" onClick={onClose}>Kapat</button>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger = false }) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50 ${danger ? "text-red-600 hover:bg-red-50" : ""}`}
      onClick={onClick}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

export function ReactBar({ open, onPick }) {
  if (!open) return null;
  return (
    <div data-chat-pop="" className="mt-1.5 flex gap-0.5 rounded-full border border-slate-200 bg-white p-1 shadow-lg">
      {CHAT_REACT_EMOJIS.map((emoji) => (
        <button key={emoji} type="button" className="grid h-8 w-8 place-items-center rounded-full text-base hover:bg-slate-50" onClick={() => onPick(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function VoiceBubble({ src, mine }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const node = audioRef.current;
    if (!node) return undefined;
    function onTime() {
      setProgress(node.currentTime);
      setDuration(node.duration || 0);
    }
    function onEnd() {
      setPlaying(false);
      setProgress(0);
    }
    node.addEventListener("timeupdate", onTime);
    node.addEventListener("loadedmetadata", onTime);
    node.addEventListener("ended", onEnd);
    return () => {
      node.removeEventListener("timeupdate", onTime);
      node.removeEventListener("loadedmetadata", onTime);
      node.removeEventListener("ended", onEnd);
    };
  }, [src]);

  function toggle() {
    const node = audioRef.current;
    if (!node) return;
    if (playing) {
      node.pause();
      setPlaying(false);
    } else {
      void node.play();
      setPlaying(true);
    }
  }

  const bars = Array.from({ length: 28 }, (_, index) => 4 + ((index * 7) % 14));
  const ratio = duration > 0 ? progress / duration : 0;

  return (
    <div className={`mt-1 flex min-w-[220px] items-center gap-2 rounded-lg px-2 py-1.5 ${mine ? "bg-[#c5f5ba]/70" : "bg-slate-50"}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" aria-label={playing ? "Durdur" : "Oynat"} className="grid h-9 w-9 place-items-center rounded-full bg-[#00a884] text-white" onClick={toggle}>
        {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-6 items-end gap-px">
          {bars.map((height, index) => (
            <span
              key={index}
              className={`w-[3px] rounded-full ${index / bars.length <= ratio ? "bg-[#00a884]" : "bg-slate-300"}`}
              style={{ height }}
            />
          ))}
        </div>
        <span className="text-[11px] text-slate-500">{formatClock(progress || duration)}</span>
      </div>
      <Mic size={14} className="text-slate-400" />
    </div>
  );
}

export function VoiceComposer({ elapsed, onCancel, onSend }) {
  return (
    <div className="flex w-full items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
      <button type="button" aria-label="Kaydı iptal et" className="grid h-9 w-9 place-items-center rounded-full text-red-500 hover:bg-red-50" onClick={onCancel}>
        <X size={18} />
      </button>
      <span className="inline-flex items-center gap-2 text-sm font-medium text-red-600">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        {formatClock(elapsed)}
      </span>
      <div className="flex h-6 flex-1 items-end gap-px">
        {Array.from({ length: 40 }, (_, index) => (
          <span key={index} className="w-[3px] rounded-full bg-red-300" style={{ height: 4 + ((index + elapsed) % 12) }} />
        ))}
      </div>
      <button type="button" aria-label="Sesli mesajı gönder" className="grid h-10 w-10 place-items-center rounded-full bg-[#00a884] text-white hover:bg-[#008f6f]" onClick={onSend}>
        <Check size={18} />
      </button>
    </div>
  );
}

export function formatClock(totalSeconds) {
  const value = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function JumpDown({ count, onClick }) {
  return (
    <button
      type="button"
      aria-label="Aşağı in"
      onClick={onClick}
      className="absolute bottom-24 right-5 z-20 grid h-11 w-11 place-items-center rounded-full bg-white text-slate-600 shadow-lg ring-1 ring-black/5 hover:bg-slate-50"
    >
      <ChevronDown size={20} />
      {count > 0 ? (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#25d366] px-1 text-[11px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}

export function ThreadSearchPanel({ open, query, onQuery, hits, onJump, onClose }) {
  if (!open) return null;
  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 bg-[#f0f2f5] px-3">
        <button type="button" aria-label="Aramayı kapat" className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-black/5" onClick={onClose}>
          <X size={18} />
        </button>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Bu sohbette ara"
          className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-sm outline-none"
          autoFocus
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!query.trim() ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Aramak için yazmaya başla.</p>
        ) : hits.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Sonuç bulunamadı.</p>
        ) : (
          <ul>
            {hits.map((hit) => (
              <li key={hit.id}>
                <button type="button" className="block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50" onClick={() => onJump(hit.id)}>
                  <p className="text-xs font-semibold text-emerald-700">{hit.authorName} · {hit.time}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-700">{hit.body}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

export function ListFilterMenu({ open, value, onChange }) {
  if (!open) return null;
  const options = [
    { id: "all", label: "Tümü" },
    { id: "unread", label: "Okunmamışlar" },
    { id: "groups", label: "Gruplar" },
    { id: "dm", label: "Direkt Mesajlar" },
    { id: "archived", label: "Arşivlenenler" },
  ];
  return (
    <div data-chat-pop="" className="absolute right-0 top-10 z-30 w-48 overflow-hidden rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${value === option.id ? "font-semibold text-[#008f6f]" : "text-slate-700"}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ThreadActionsMenu({
  open,
  thread,
  onPin,
  onMarkRead,
  onMutePick,
  onArchive,
  onDelete,
  onClose,
}) {
  const [muteOpen, setMuteOpen] = useState(false);
  if (!open || !thread) return null;
  return (
    <div data-chat-pop="" className="absolute right-2 top-10 z-40 w-56 overflow-hidden rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5">
      <MenuItem icon={Pin} label={thread.pinned ? "Sabiti kaldır" : "Sohbeti sabitle"} onClick={() => { onPin(); onClose(); }} />
      <MenuItem
        icon={Check}
        label={thread.unread > 0 ? "Okundu olarak işaretle" : "Okunmadı olarak işaretle"}
        onClick={() => { onMarkRead(); onClose(); }}
      />
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-slate-50"
        onClick={() => {
          if (thread.muted) {
            onMutePick("off");
            onClose();
            return;
          }
          setMuteOpen((value) => !value);
        }}
      >
        <BellOff size={14} />
        {thread.muted ? "Sesi aç" : "Sessize al"}
        {!thread.muted ? <ChevronDown size={12} className="ml-auto text-slate-400" /> : null}
      </button>
      {muteOpen && !thread.muted ? (
        <div className="border-y border-slate-100 bg-slate-50 py-1">
          {[
            { id: "8h", label: "8 saat" },
            { id: "1w", label: "1 hafta" },
            { id: "always", label: "Her zaman" },
          ].map((option) => (
            <button key={option.id} type="button" className="block w-full px-5 py-2 text-left text-xs text-slate-600 hover:bg-white" onClick={() => { onMutePick(option.id); onClose(); }}>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <MenuItem icon={Archive} label={thread.archived ? "Arşivden çıkar" : "Sohbeti arşivle"} onClick={() => { onArchive(); onClose(); }} />
      <MenuItem icon={Trash2} label="Sohbeti sil" danger onClick={() => { onDelete(); onClose(); }} />
    </div>
  );
}

export function ContactCard({ name, image, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="mt-1 flex w-full min-w-[200px] items-center gap-3 rounded-lg bg-white/80 px-3 py-2 text-left">
      <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-slate-200">
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Contact size={18} className="text-slate-500" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-800">{name}</span>
        <span className="block text-xs text-[#008f6f]">Kişi kartı</span>
      </span>
    </button>
  );
}

export function MuteBadge() {
  return <VolumeX size={12} className="text-slate-400" />;
}

export function PinBadge() {
  return <Pin size={12} className="rotate-45 text-slate-400" />;
}

export function StarBadge() {
  return <Star size={12} className="fill-amber-400 text-amber-400" />;
}
