import { useState } from 'react';
import { CAPTIVE_OPTIONS, captiveBlocked, ransomFor, type CaptiveOption } from '../../sim/capture';
import { networkOf } from '../../sim/network';
import { LOST_CHOICES, lostBlocked, type LostChoice } from '../../sim/remnants';
import type { Id } from '../../sim/state';
import { useGame } from '../store';
import { charLabel } from '../util';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const OPTION_LABEL: Record<CaptiveOption, string> = {
  ransom: 'Ransom',
  trade: 'Trade',
  interrogate: 'Interrogate',
  turn: 'Turn him',
  leverage: 'Leverage',
  hand_over: 'Hand to the State',
  execute: 'Execute',
  release: 'Release',
};

const OPTION_TIP: Record<CaptiveOption, string> = {
  ransom: 'His side pays, scaled by rank. Money, and a grudge.',
  trade: 'Swap him for one of your people they hold.',
  interrogate: "He gives up his side's crews and plans; costs his health and angers his family.",
  turn: 'He joins your side; easier if he resents his own head.',
  leverage: 'Hold him to force a truce from his head in his region.',
  hand_over: 'Calentura falls and the State likes you; other narcos see a snitch.',
  execute: 'Fear rises, calentura spikes, and his family swears vengeance.',
  release: 'He owes you his life.',
};

/** Prisoners you hold (you decide their fate), and your people held by others. */
export function Captives() {
  const { content, game, enqueue, select } = useGame();
  const [trade, setTrade] = useState<Record<Id, Id>>({});
  if (!game) return null;
  const me = game.playerId;
  const net = networkOf(game, me);
  const held = Object.values(game.characters).filter((c) => c.status === 'captured' && c.captor === me);
  const ours = Object.values(game.characters).filter((c) => c.status === 'captured' && c.id !== me && networkOf(game, c.id) === net);
  return (
    <>
      <h3>Captives</h3>
      {held.length === 0 && <p className="muted small">You hold no one.</p>}
      {held.map((c) => (
        <div key={c.id} className="request small">
          <div>
            <button className="linkish" onClick={() => select({ kind: 'character', id: c.id })}>
              {charLabel(game, c.id)}
            </button>{' '}
            <span className="muted">
              {c.rank.replace('_', ' ')} · held {Math.floor((game.hour - c.statusSince) / 24)} days · ransom {money(ransomFor(content, game, c.id))}
              {c.interrogated > 0 && ` · questioned ${c.interrogated}×`}
            </span>
          </div>
          <div className="actions">
            {CAPTIVE_OPTIONS.map((o) => {
              const why = captiveBlocked(game, content, me, c.id, o, o === 'trade' ? (trade[c.id] ?? ours[0]?.id ?? null) : null);
              return (
                <button key={o} className="small" disabled={why !== null} title={why ?? OPTION_TIP[o]} onClick={() => enqueue({ type: 'captive', issuer: me, captive: c.id, option: o, trade: o === 'trade' ? (trade[c.id] ?? ours[0]?.id ?? null) : null })}>
                  {OPTION_LABEL[o]}
                </button>
              );
            })}
          </div>
          {ours.length > 1 && (
            <label className="small">
              Trade for{' '}
              <select value={trade[c.id] ?? ours[0]!.id} onChange={(e) => setTrade({ ...trade, [c.id]: e.target.value })}>
                {ours.map((o) => (
                  <option key={o.id} value={o.id}>
                    {charLabel(game, o.id)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ))}
      {ours.length > 0 && (
        <p className="muted small">
          Your side's people held by others: {ours.map((o) => `${charLabel(game, o.id)} (by ${charLabel(game, o.captor!)})`).join(', ')}.
        </p>
      )}
    </>
  );
}

const LOST_LABEL: Record<LostChoice, string> = {
  ground: 'Go to ground',
  serve: 'Serve another boss',
  neutral: 'Go neutral and rebuild',
  defect: 'Defect',
  flee: 'Flee Sinaloa',
};

const LOST_TIP: Record<LostChoice, string> = {
  ground: 'Take your men into the hills around your old plaza: raid, ambush, and wait for the garrison to leave.',
  serve: 'Join a stronger boss on your side as one of his lieutenants; your crews go into his force.',
  neutral: 'Leave your side with your men and cash, and take a plaza anywhere.',
  defect: "Offer yourself to the other side, with what you know of your old side's ground.",
  flee: 'Leave the board with your cash. The game ends.',
};

/** The choice for a player who has lost his last plaza. */
export function LostEverything() {
  const { game, enqueue } = useGame();
  if (!game) return null;
  const me = game.playerId;
  const ch = game.characters[me]!;
  if (ch.lostEverythingAt === null) return null;
  return (
    <div className="request">
      <h3>You have lost your last plaza</h3>
      <p className="small muted">You are not finished. Choose what to do.</p>
      <div className="actions">
        {LOST_CHOICES.map((c) => {
          const why = lostBlocked(game, me, c, null);
          return (
            <button key={c} className="small" disabled={why !== null} title={why ?? LOST_TIP[c]} onClick={() => enqueue({ type: 'lost_everything', issuer: me, choice: c })}>
              {LOST_LABEL[c]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
