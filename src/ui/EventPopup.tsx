import { formatDateTime } from '../sim/clock';
import { newContext } from '../sim/context';
import { describeEffects, eventText, instanceOf, optionBlocked } from '../sim/systems/events';
import { useGame } from './store';

/**
 * The event popup (GDD "Event popup"): title, text, and options with a hover
 * preview of their effects. The player can put a decision aside; unanswered
 * events resolve on their own after a few days.
 */
export function EventPopup() {
  const { content, game, enqueue, queue, deferredEvents, set } = useGame();
  if (!game || game.ended) return null;
  const mine = game.pendingEvents.filter((e) => e.decider === game.playerId);
  const answered = new Set(queue.flatMap((c) => (c.type === 'choose_event_option' ? [c.instance] : [])));
  const pe = mine.find((e) => !deferredEvents.includes(e.instance) && !answered.has(e.instance));
  if (!pe) return null;
  const ctx = newContext(game, content);
  const inst = instanceOf(ctx, pe);
  if (!inst) return null;
  const left = content.tuning.events.autoResolveHours - (game.hour - pe.firedAt);
  return (
    <div className="endscreen eventpop" role="dialog" aria-labelledby="event-title">
      <div className="endcard eventcard">
        <p className="muted small">{formatDateTime(pe.firedAt, content.tuning)}</p>
        <h2 id="event-title">{inst.def.title}</h2>
        <p>{eventText(ctx, inst, inst.def.text)}</p>
        <div className="options">
          {inst.def.options.map((o, i) => {
            const blocked = optionBlocked(ctx, inst, i);
            const preview = describeEffects(content, o.effects);
            return (
              <button
                key={i}
                className="option"
                disabled={blocked !== null}
                title={blocked ?? preview.join('\n')}
                onClick={() => enqueue({ type: 'choose_event_option', issuer: game.playerId, instance: pe.instance, option: i })}
              >
                <span>{o.label}</span>
                <span className="muted small">{blocked ?? preview.join(' · ')}</span>
              </button>
            );
          })}
        </div>
        <p className="row small">
          <button className="small" onClick={() => set({ deferredEvents: [...deferredEvents, pe.instance] })}>
            Decide later
          </button>
          <span className="muted">Your people decide in {Math.max(0, Math.ceil(left / 24))} days if you don't.</span>
          {mine.length > 1 && <span className="muted">{mine.length - 1} more waiting</span>}
        </p>
      </div>
    </div>
  );
}

/** Top-bar button that brings back decisions put aside. */
export function DecisionsButton() {
  const { game, deferredEvents, set } = useGame();
  if (!game) return null;
  const waiting = game.pendingEvents.filter((e) => e.decider === game.playerId && deferredEvents.includes(e.instance)).length;
  if (!waiting) return null;
  return (
    <button className="small" onClick={() => set({ deferredEvents: [] })}>
      Decisions<span className="badge">{waiting}</span>
    </button>
  );
}
