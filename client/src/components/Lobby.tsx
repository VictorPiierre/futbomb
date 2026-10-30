import { useState } from 'react';
import { MAX_PLAYERS, MIXED_THEME, THEMES, THEME_IDS, TURN_TIMES, themeLabel, type PublicRoom, type Settings } from '../../../shared/types';
import { emitAck, inviteLink, socket } from '../net';
import Avatar, { Hearts } from './Avatar';
import { IconCopy, IconCrown, IconLink } from './Icons';

interface Props {
  room: PublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

export default function Lobby({ room, meId, isHost, onCopy }: Props) {
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const ready = room.players.filter((p) => p.connected).length;
  const amSpectator = room.spectators.some((s) => s.id === meId);
  const seatFree = room.players.length < room.settings.maxPlayers;
  const slots = Array.from({ length: room.settings.maxPlayers }, (_, i) => room.players[i] ?? null);

  async function start() {
    setStarting(true);
    const res = await emitAck<{ ok: boolean; error?: string }>('game:start');
    setStarting(false);
    setError(res.ok ? '' : (res.error ?? 'Erro ao iniciar.'));
  }

  return (
    <div className="pop-in grid gap-5 lg:grid-cols-[1fr_380px]">
      <section className="glass rounded-3xl p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-muted uppercase">Sala de espera</p>
            <h1 className="font-display text-2xl sm:text-3xl">
              {room.players.length}/{room.settings.maxPlayers} jogadores
            </h1>
          </div>
          <span className="rounded-full bg-panel-2 px-3 py-1 text-xs text-muted">Todos começam com ❤️❤️</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {slots.map((p, i) =>
            p ? (
              <div key={p.id} className={`pop-in flex flex-col items-center gap-2 rounded-2xl border p-4 ${p.id === meId ? 'border-lime/50 bg-lime/5' : 'border-line bg-panel/60'}`}>
                <div className="relative">
                  <Avatar emoji={p.avatar} id={p.id} size={64} dim={!p.connected} />
                  {p.id === room.hostId && (
                    <span className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-violet text-white" title="Anfitrião">
                      <IconCrown width={13} />
                    </span>
                  )}
                </div>
                <span className="max-w-full truncate font-semibold">
                  {p.name}
                  {p.id === meId && <span className="text-muted"> (você)</span>}
                </span>
                {p.connected ? <Hearts lives={2} size={14} /> : <span className="text-xs text-danger">reconectando…</span>}
              </div>
            ) : (
              <div key={`empty-${i}`} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line p-4 text-muted">
                <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-dashed border-line text-2xl opacity-60">?</div>
                <span className="text-sm">Aguardando…</span>
              </div>
            ),
          )}
        </div>

        {room.spectators.length > 0 && (
          <div className="mt-5 rounded-2xl border border-line bg-panel/50 p-4">
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Espectadores</p>
            <div className="flex flex-wrap gap-2">
              {room.spectators.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5 rounded-full bg-panel-2 py-1 pr-3 pl-1 text-sm">
                  <Avatar emoji={s.avatar} id={s.id} size={24} dim={!s.connected} /> {s.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {amSpectator && (
            <button disabled={!seatFree} onClick={() => socket.emit('room:seat', true)} className="btn-secondary px-4 text-sm">
              {seatFree ? 'Entrar como jogador' : 'Sala cheia — você está assistindo'}
            </button>
          )}
          {!amSpectator && !isHost && (
            <button onClick={() => socket.emit('room:seat', false)} className="cursor-pointer text-sm text-muted hover:text-white">
              Apenas assistir
            </button>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-violet/30 bg-violet/10 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-soft">
            <IconLink width={16} /> Convide seus amigos
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-ink/60 px-3 py-2.5 text-sm">{inviteLink(room.code)}</code>
            <button onClick={onCopy} className="btn-secondary flex items-center gap-1.5 px-4 text-sm">
              <IconCopy width={15} /> Copiar
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Ou passe o código <b className="font-display text-violet-soft">{room.code}</b>
          </p>
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <SettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2 || starting} className="btn-primary w-full py-4 text-xl">
                Iniciar partida
              </button>
              {ready < 2 && <p className="mt-2 text-center text-xs text-muted">Precisa de pelo menos 2 jogadores conectados.</p>}
            </>
          ) : (
            <div className="rounded-xl bg-panel-2 py-4 text-center text-sm text-muted">
              Aguardando {room.hostName} iniciar a partida…
            </div>
          )}
          {error && <p className="slide-in mt-3 text-center text-sm text-danger">{error}</p>}
        </div>
      </aside>
    </div>
  );
}

export function SettingsPanel({ room, editable }: { room: PublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<Settings>) => editable && socket.emit('room:settings', patch);

  return (
    <div className="space-y-5">
      <Field label="Tema">
        <div className="grid grid-cols-3 gap-2">
          {[...THEME_IDS.map((id) => [id, THEMES[id].icon, THEMES[id].short] as const), ['mixed', MIXED_THEME.icon, MIXED_THEME.short] as const].map(
            ([value, icon, label]) => (
              <button
                key={value}
                disabled={!editable}
                onClick={() => set({ theme: value })}
                title={themeLabel(value)}
                className={`chip flex flex-col items-center gap-0.5 px-1 py-2.5 text-xs ${s.theme === value ? 'chip-on' : editable ? 'hover:border-line hover:bg-line/40' : 'opacity-60'}`}
              >
                <span className="text-xl">{icon}</span>
                {label}
              </button>
            ),
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          {s.theme === 'mixed'
            ? '🎲 O tema muda a cada volta! (Xingamentos fica de fora)'
            : s.theme === 'insults'
              ? '🔞 Tema adulto: palavrões e xingamentos'
              : `Tema: ${themeLabel(s.theme)}`}
        </p>
      </Field>
      <Field label="Tempo por jogador">
        <div className="flex flex-wrap gap-2">
          {TURN_TIMES.map((t) => (
            <button key={t} disabled={!editable} onClick={() => set({ turnTime: t })} className={`chip flex-1 ${s.turnTime === t ? 'chip-on' : !editable ? 'opacity-60' : ''}`}>
              {t}s
            </button>
          ))}
        </div>
      </Field>
      <Field label="Máximo de jogadores">
        <div className="flex gap-2">
          {MAX_PLAYERS.map((n) => {
            const tooFew = n < room.players.length;
            return (
              <button
                key={n}
                disabled={!editable || tooFew}
                onClick={() => set({ maxPlayers: n })}
                className={`chip flex-1 ${s.maxPlayers === n ? 'chip-on' : !editable || tooFew ? 'opacity-50' : ''}`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Vidas">
        <div className="chip flex cursor-default items-center justify-between opacity-90">
          <span>2 vidas para todos</span>
          <Hearts lives={2} size={14} />
        </div>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{label}</p>
      {children}
    </div>
  );
}
