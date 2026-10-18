import { useEffect, useRef, useState } from 'react';
import { COMPLETE_GROWTH_INDEX, DAY_MS } from '../core/constants';
import type { GameState, Pixel } from '../core/types';
import type { GameController } from '../engine/gameController';
import { drawThumbnail } from '../render/renderer';
import { statsFromColors, type Stats } from '../core/stats';
import { NameForm } from './NameForm';
import { StatsCard } from './StatsCard';
import { BattleScreen } from './BattleScreen';

const fmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });

interface Props {
  controller: GameController;
  onClose: () => void;
  /** Opened to pick a creature for a battle: shows a hint above the list. */
  forBattle?: boolean;
  /** 'champion': opened to choose the ranked representative. */
  mode?: 'champion';
  onChampionChosen?: () => void;
}

/**
 * Creatures the player has finished and put away. The list stays light for
 * hundreds of entries (small cards, thumbnails drawn only when scrolled into
 * view); tapping one opens its detail, where it can be sent into a battle.
 */
export function CollectionScreen({ controller, onClose, forBattle, mode, onChampionChosen }: Props) {
  const [items, setItems] = useState<GameState[] | null>(null);
  const [open, setOpen] = useState<GameState | null>(null);
  const [battling, setBattling] = useState(false);
  const [champion, setChampion] = useState<string | null>(null);
  useEffect(() => {
    void controller.getChampionId().then(setChampion);
  }, [controller]);

  const reload = () => controller.listCollection().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void reload();
  }, [controller]);

  if (open && battling) return <BattleScreen controller={controller} game={open} onClose={() => setBattling(false)} />;

  return (
    <div className="sheet" role="dialog" aria-label="図鑑" data-testid="collection-screen">
      <header className="sheet-header">
        <button className="text-btn" onClick={open ? () => setOpen(null) : onClose} data-testid="close-collection">
          ← 戻る
        </button>
        <h2>図鑑</h2>
        <span />
      </header>
      <div className="sheet-body">
        {open ? (
          <CollectionDetail
            game={open}
            number={items ? items.length - items.findIndex((g) => g.gameId === open.gameId) : 0}
            controller={controller}
            onRenamed={(g) => {
              setOpen(g);
              void reload();
            }}
            onBattle={() => setBattling(true)}
            isChampion={champion === open.gameId}
            onMakeChampion={async () => {
              await controller.setChampion(open.gameId);
              setChampion(open.gameId);
              onChampionChosen?.();
            }}
            onDeleted={() => {
              setOpen(null);
              void reload();
            }}
          />
        ) : items === null ? null : items.length === 0 ? (
          <div className="empty-collection">
            <p>まだ図鑑に入った子はいません。</p>
            <p className="muted small">30日育てて完成した子を「図鑑にしまう」と、ここに残ります。</p>
          </div>
        ) : (
          <>
          <p className="muted small collection-hint" data-testid="collection-hint">
            {mode === 'champion'
              ? `ランク戦の代表をえらんでね（完成した子だけ・${items.length.toLocaleString()}体）`
              : forBattle
                ? `対決させたい子をえらんでね（${items.length.toLocaleString()}体）`
                : `全${items.length.toLocaleString()}体 ・ タップすると詳しく見られます`}
          </p>
          <ul className="collection-grid" data-testid="collection-list">
            {items.map((g, i) => (
              <li key={g.gameId}>
                <button className="collection-card" onClick={() => setOpen(g)} data-testid="collection-item">
                  <Thumb controller={controller} game={g} size={96} lazy />
                  <span className="collection-name" data-testid="collection-name">
                    {champion === g.gameId && <span aria-label="代表">★ </span>}
                    {displayName(g, items.length - i)}
                  </span>
                  <span className="muted small card-meta">No.{items.length - i}</span>
                  <span className="muted small card-meta">{(g.lastProcessedGrowthIndex + 1).toLocaleString()} dots</span>
                </button>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Thumb({ controller, game, size, lazy }: { controller: GameController; game: GameState; size: number; lazy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [pixels, setPixels] = useState<Pixel[] | null>(null);
  const [visible, setVisible] = useState(!lazy || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void controller.loadCollectionPixels(game.gameId).then((p) => alive && setPixels(p));
    return () => {
      alive = false;
    };
  }, [controller, game.gameId, visible]);
  useEffect(() => {
    if (ref.current && pixels) drawThumbnail(ref.current, pixels, pixels.length, { outline: true, maxScale: size > 200 ? 24 : 12 });
  }, [pixels, size]);
  const px = Math.round(size * Math.min(3, globalThis.devicePixelRatio || 1));
  return <canvas ref={ref} width={px} height={px} className="collection-thumb" style={{ width: size, height: size }} aria-hidden />;
}

function displayName(g: GameState, number: number): string {
  return g.name ?? `No.${number}`;
}

interface DetailProps {
  game: GameState;
  number: number;
  controller: GameController;
  onDeleted: () => void;
  onRenamed: (g: GameState) => void;
  onBattle: () => void;
  isChampion: boolean;
  onMakeChampion: () => Promise<void>;
}

function CollectionDetail({ game, number, controller, onDeleted, onRenamed, onBattle, isChampion, onMakeChampion }: DetailProps) {
  const finished = game.lastProcessedGrowthIndex + 1 >= COMPLETE_GROWTH_INDEX + 1;
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = Math.floor((game.lastProcessedGrowthIndex * 3_600_000) / DAY_MS);
  return (
    <div className="collection-detail" data-testid="collection-detail">
      {renaming ? (
        <NameForm
          initial={game.name ?? ''}
          submitLabel="名前を保存"
          onCancel={() => setRenaming(false)}
          onSubmit={async (name) => {
            const g = await controller.renameInCollection(game.gameId, name);
            setRenaming(false);
            onRenamed(g);
          }}
        />
      ) : (
        <div className="detail-title">
          <h3 data-testid="detail-name">{displayName(game, number)}</h3>
          <button className="text-btn" data-testid="rename" onClick={() => setRenaming(true)}>
            名前を変える
          </button>
        </div>
      )}
      <Thumb controller={controller} game={game} size={Math.min(340, (globalThis.innerWidth || 360) - 32)} />
      <DetailStats controller={controller} gameId={game.gameId} />
      <button className="btn primary wide" data-testid="battle-with" onClick={onBattle}>
        ⚔ このドットで戦う
      </button>
      {isChampion ? (
        <p className="champion-badge" data-testid="is-champion">★ ランク戦の代表です</p>
      ) : finished ? (
        <button
          className="btn wide"
          data-testid="make-champion"
          onClick={() => onMakeChampion().catch((e) => setError((e as Error).message))}
        >
          ★ ランク戦の代表にする
        </button>
      ) : (
        <p className="muted small">ランク戦の代表になれるのは、完成した（721ドットの）子だけです。</p>
      )}
      <dl className="detail-facts">
        <div>
          <dt>ドット</dt>
          <dd>{(game.lastProcessedGrowthIndex + 1).toLocaleString()}</dd>
        </div>
        <div>
          <dt>育てた日数</dt>
          <dd>{days}日</dd>
        </div>
        <div className="span-2">
          <dt>期間</dt>
          <dd>
            {fmt.format(game.startedAt)} 〜 {fmt.format(game.archivedAt ?? game.updatedAt)}
          </dd>
        </div>
      </dl>
      {confirm ? (
        <div className="btn-row">
          <button className="btn" onClick={() => setConfirm(false)}>キャンセル</button>
          <button
            className="btn danger"
            data-testid="confirm-delete-collection"
            onClick={async () => {
              try {
                await controller.deleteFromCollection(game.gameId);
                onDeleted();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            図鑑から消す（元に戻せません）
          </button>
        </div>
      ) : (
        <button className="text-btn danger-text" onClick={() => setConfirm(true)}>
          図鑑から消す…
        </button>
      )}
      {error && <p className="notice err">{error}</p>}
    </div>
  );
}

function DetailStats({ controller, gameId }: { controller: GameController; gameId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    void controller.loadCollectionPixels(gameId).then((p) => alive && setStats(statsFromColors(p.map((x) => x.color))));
    return () => {
      alive = false;
    };
  }, [controller, gameId]);
  return stats ? <StatsCard stats={stats} testId="collection-stats" /> : null;
}
