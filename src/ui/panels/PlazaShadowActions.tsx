import { newContext } from '../../sim/context';
import { networkOf } from '../../sim/network';
import { schemeBlocked } from '../../sim/systems/schemes';
import { useGame } from '../store';
import { charLabel, playerNetwork } from '../util';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Banners, shows of force, tip-offs, and buying halcones, for the selected plaza. */
export function PlazaShadowActions({ id }: { id: string }) {
  const { content, game, enqueue, select } = useGame();
  if (!game) return null;
  const p = game.nodes[id]!;
  const me = game.playerId;
  const net = playerNetwork(game);
  const mine = p.owner === me;
  const rival = p.owner !== null && networkOf(game, p.owner) !== net;
  const present = Object.values(game.crews).some((c) => c.owner === me && c.location.kind === 'node' && c.location.node === id && c.battle === null);
  const t = content.tuning;
  const buy = rival ? schemeBlocked(newContext(game, content), me, 'buy_halcones', id) : 'not a rival plaza';
  const ourSide = p.owner !== null && !rival;
  const aligned = game.characters[me]!.faction !== null;
  const isTown = content.nodes.find((n) => n.id === id)!.type !== 'border_exit' && id !== content.culiacan.parentNode;
  if (!mine && !rival && !present && !(ourSide && aligned)) return null;
  return (
    <>
      {aligned && isTown && (rival || ourSide) && (
        <>
          <h3>With your side</h3>
          <div className="actions">
            {rival && (
              <button className="small" title="Invite bosses on your side to hit this plaza together. Free for them to refuse." onClick={() => select({ kind: 'plan_attack', id })}>
                Plan joint attack
              </button>
            )}
            {ourSide && (
              <button className="small" title="Ask bosses on your side to help hold this plaza. Free for them to refuse." onClick={() => select({ kind: 'plan_defend', id })}>
                Ask for help holding
              </button>
            )}
          </div>
        </>
      )}
      <h3>In the shadows</h3>
      <div className="actions">
        {(mine || present) && (
          <button
            className="small"
            title={`${money(t.infowar.narcomanta.cost)}: +fear; ${mine ? 'claims the plaza (+support)' : 'a warning'}`}
            onClick={() => enqueue({ type: 'narcomanta', issuer: me, node: id })}
          >
            Hang a banner
          </button>
        )}
        {rival && present && (
          <button
            className="small"
            title={`${money(t.infowar.narcomanta.cost)}: name ${charLabel(game, p.owner!)} on a banner here`}
            onClick={() => enqueue({ type: 'narcomanta', issuer: me, node: id, target: p.owner })}
          >
            Banner naming {charLabel(game, p.owner!)}
          </button>
        )}
        {mine && present && (
          <button className="small" title="Parade your crews: +fear, +recruits; big calentura, and everyone learns where your crews are" onClick={() => enqueue({ type: 'show_of_force', issuer: me, node: id })}>
            Show of force
          </button>
        )}
        {rival && (
          <button className="small" title={`${money(t.state.tipOff.cost)}: the army hits this plaza's lab or stash house; they may find out it was you`} onClick={() => enqueue({ type: 'tip_off', issuer: me, node: id })}>
            Tip off the army
          </button>
        )}
        {rival && (
          <button
            className="small"
            disabled={buy !== null}
            title={buy ?? `${money(t.schemes.types.buy_halcones.cost)} up front: their halcones report to you`}
            onClick={() => enqueue({ type: 'start_scheme', issuer: me, scheme: 'buy_halcones', target: id })}
          >
            Buy their halcones
          </button>
        )}
      </div>
      {p.halconesBoughtBy === net && <p className="small muted">These halcones report to you.</p>}
    </>
  );
}
