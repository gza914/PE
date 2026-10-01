import { useState } from 'react';
import type { RumorKind } from '../../sim/state';
import { newContext } from '../../sim/context';
import { networkOf } from '../../sim/network';
import { SCHEME_LABEL, schemeVictim } from '../../sim/systems/schemes';
import { commanderBribed, hasPolice, lyingLow, tierOf } from '../../sim/systems/stateForces';
import { world } from '../../sim/world';
import { useGame } from '../store';
import { Captives, LostEverything } from './Captives';
import { charLabel, playerNetwork } from '../util';

const TIER_LABEL = { normal: 'Normal', elevated: 'Elevated', surge: 'Surge', occupation: 'Occupation' } as const;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Everything in the shadows: your standing and how close the State is, the
 * State region by region (bribes, police, lying low, scapegoats), messages
 * (videos, claims, corridos, rumors), your schemes, and local truces.
 */
export function ShadowPanel() {
  const { content, game, enqueue, select } = useGame();
  const [rumorKind, setRumorKind] = useState<RumorKind>('fake_convoy');
  if (!game) return null;
  const me = game.characters[game.playerId]!;
  const id = me.id;
  const net = playerNetwork(game);
  const w = world(content);
  const t = content.tuning;
  const rivals = content.factions.filter((f) => f.kind === 'major' && f.id !== net);
  const myRegions = new Set(Object.values(game.nodes).filter((n) => n.owner === id).map((n) => w.node(n.id).region));
  const schemes = game.schemes.filter((s) => s.owner === id);
  const truces = game.pacts.filter((p) => p.type === 'local_truce' && (p.expiresAt ?? Infinity) > game.hour && p.parties.some((x) => networkOf(game, x) === net));
  const videoReady = me.lastVideoAt === null || game.hour - me.lastVideoAt >= t.infowar.video.cooldownDays * 24;
  const claimReady = me.lastClaimAt === null || game.hour - me.lastClaimAt >= t.infowar.claim.cooldownDays * 24;
  const corridoPlaying = me.corridoUntil !== null && me.corridoUntil > game.hour;
  const ctx = newContext(game, content);

  return (
    <div className="shadow">
      <LostEverything />
      <Captives />
      <h3>You</h3>
      <dl>
        <dt>Fear · Respect</dt>
        <dd>
          {Math.round(me.fear)} · {Math.round(me.respect)}
        </dd>
        <dt>Credibility</dt>
        <dd title="Scales the effect of every message you send. Exposed lies lower it.">{Math.round(me.credibility)}</dd>
        <dt>Profile</dt>
        <dd title={`Above ${t.state.captureOpProfileThreshold}, the State starts building a case on you.`}>{Math.round(me.profile)}</dd>
        <dt>State intel</dt>
        <dd className={me.stateIntel >= 70 ? 'warn' : ''} title="At 100 the State launches a capture operation.">
          <span className="meter">
            <span style={{ width: `${me.stateIntel}%` }} />
          </span>{' '}
          {Math.round(me.stateIntel)}
        </dd>
      </dl>

      <h3>The State</h3>
      <div className="small">
        {content.regions.map((r) => {
          const reg = game.regions[r.id]!;
          const tier = tierOf(content, reg.calentura);
          const bribed = commanderBribed(ctx, r.id, net);
          const police = hasPolice(ctx, id, r.id);
          const low = lyingLow(ctx, id, r.id);
          const mine = myRegions.has(r.id);
          const rotates = Math.max(0, Math.ceil((reg.commanderRotatesAt - game.hour) / 24));
          const taken = !bribed && reg.commanderBribedUntil !== null && reg.commanderBribedUntil > game.hour;
          return (
            <div key={r.id} className={`stateregion${mine ? '' : ' muted'}`}>
              <div className="row">
                <strong>{r.name}</strong>
                <span className={`tier ${tier}`} title={`Calentura ${Math.round(reg.calentura)}`}>
                  {TIER_LABEL[tier]} {Math.round(reg.calentura)}
                </span>
                <span title={`The commander rotates out in ${rotates} days`}>
                  commander {bribed ? 'yours' : taken ? 'bought' : 'honest'}
                  {police ? ' · police yours' : ''}
                  {low ? ' · lying low' : ''}
                </span>
              </div>
              <div className="actions">
                {!bribed && (
                  <button
                    className="small"
                    disabled={rotates < t.state.commanderMinDaysLeft}
                    title={rotates < t.state.commanderMinDaysLeft ? `He rotates out in ${rotates} days; wait for the new one` : `${money(t.state.commanderBribeCost)}: fewer checkpoints and raids here for up to ${Math.min(rotates, t.state.commanderBribeDays)} days`}
                    onClick={() => enqueue({ type: 'bribe_commander', issuer: id, region: r.id })}
                  >
                    Bribe commander
                  </button>
                )}
                {!police && (
                  <button className="small" title={`${money(t.state.police.cost)} for ${t.state.police.days} days: raid warnings and +${t.state.police.halconBonus} halcón coverage`} onClick={() => enqueue({ type: 'bribe_police', issuer: id, region: r.id })}>
                    Buy the police
                  </button>
                )}
                {mine && !low && (
                  <button className="small" title={`${t.state.lieLow.days} days: calentura cools faster, income here halves`} onClick={() => enqueue({ type: 'lie_low_region', issuer: id, region: r.id })}>
                    Lie low
                  </button>
                )}
                <button className="small" title={`Give up ${t.state.scapegoat.men} men: −${t.state.scapegoat.calenturaDrop} calentura; their leader will not forget`} onClick={() => enqueue({ type: 'hand_over_scapegoat', issuer: id, region: r.id })}>
                  Scapegoat
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small">Tip off the army about a rival from the plaza panel.</p>

      <h3>Messages</h3>
      <div className="actions">
        <button className="small" disabled={!videoReady} title={`${money(t.infowar.video.cost)}: lifts your side's morale statewide; raises your profile and calentura`} onClick={() => enqueue({ type: 'video', issuer: id, tone: 'rally' })}>
          Rally video
        </button>
        {rivals.map((f) => (
          <button key={f.id} className="small" disabled={!videoReady} title={`${money(t.infowar.video.cost)}: hits the ${f.name}' morale`} onClick={() => enqueue({ type: 'video', issuer: id, tone: 'threat', target: f.id })}>
            Threaten the {f.name}
          </button>
        ))}
      </div>
      <div className="actions">
        {rivals.map((f) => (
          <span key={f.id}>
            <button className="small" disabled={!claimReady} title="Claim a victory. True only if your side won a fight in the last few days; lies can be exposed." onClick={() => enqueue({ type: 'social_claim', issuer: id, claim: 'victory', against: f.id })}>
              Claim a win over the {f.name}
            </button>
            <button className="small" disabled={!claimReady} title="Claim they are weak. True only if they are exhausted or short of supply." onClick={() => enqueue({ type: 'social_claim', issuer: id, claim: 'enemy_weak', against: f.id })}>
              Say the {f.name} are breaking
            </button>
          </span>
        ))}
      </div>
      <div className="actions">
        <button className="small" disabled={corridoPlaying} title={`${money(t.infowar.corrido.cost)}: respect and recruits for ${t.infowar.corrido.days} days; the State notices`} onClick={() => enqueue({ type: 'commission_corrido', issuer: id })}>
          {corridoPlaying ? 'Corrido playing' : 'Commission a corrido'}
        </button>
      </div>
      <div className="actions">
        <select value={rumorKind} onChange={(e) => setRumorKind(e.target.value as RumorKind)} aria-label="Rumor">
          <option value="fake_convoy">Fake convoy on a road near home</option>
          <option value="fake_weakness">Your home plaza is barely guarded</option>
        </select>
        {rivals.map((f) => (
          <button key={f.id} className="small" title={`${money(t.infowar.rumor.cost)}: planted in the ${f.name}' intel; their sharpest minds may see through it`} onClick={() => enqueue({ type: 'plant_rumor', issuer: id, network: f.id, kind: rumorKind })}>
            Plant with the {f.name}
          </button>
        ))}
      </div>
      <p className="muted small">Banners and shows of force are on the plaza panel; rumors about a person on their character panel.</p>

      <h3>Schemes</h3>
      {schemes.length === 0 && <p className="muted small">None running. Start one from a character or plaza.</p>}
      {schemes.map((s) => {
        const victim = schemeVictim(game, s);
        return (
          <div key={s.id} className="scheme small">
            <span>
              {SCHEME_LABEL[s.type]}:{' '}
              {s.type === 'buy_halcones' ? (
                <button className="linkish" onClick={() => select({ kind: 'node', id: s.target })}>
                  {w.node(s.target).name}
                </button>
              ) : (
                <button className="linkish" onClick={() => victim && select({ kind: 'character', id: victim })}>
                  {charLabel(game, s.target)}
                </button>
              )}
            </span>
            <span className="meter">
              <span style={{ width: `${s.progress}%` }} />
            </span>
            <button className="small" onClick={() => enqueue({ type: 'cancel_scheme', issuer: id, scheme: s.id })}>
              Drop
            </button>
          </div>
        );
      })}

      {truces.length > 0 && (
        <>
          <h3>Local truces</h3>
          <ul className="small">
            {truces.map((p) => (
              <li key={p.id}>
                {content.regions.find((r) => r.id === p.region)?.name}: until day {Math.floor((p.expiresAt ?? 0) / 24)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
