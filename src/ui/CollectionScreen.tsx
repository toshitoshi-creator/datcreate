import { useEffect, useRef, useState } from 'react';
import { DAY_MS } from '../core/constants';
import type { GameState, Pixel } from '../core/types';
import type { GameController } from '../engine/gameController';
import { drawThumbnail } from '../render/renderer';
import { NameForm } from './NameForm';
import { lookLabel } from './styleLabels';

const fmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });

/** Creatures the player has finished and put away. Read-only views of stored dots. */
export function CollectionScreen({ controller, onClose }: { controller: GameController; onClose: () => void }) {
  const [items, setItems] = useState<GameState[] | null>(null);
  const [open, setOpen] = useState<GameState | null>(null);

  const reload = () => controller.listCollection().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void reload();
  }, [controller]);

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
          <ul className="collection-grid" data-testid="collection-list">
            {items.map((g, i) => (
              <li key={g.gameId}>
                <button className="collection-card" onClick={() => setOpen(g)} data-testid="collection-item">
                  <Thumb controller={controller} game={g} size={150} />
                  <span className="collection-name" data-testid="collection-name">{displayName(g, items.length - i)}</span>
                  <span className="muted small">No.{items.length - i}</span>
                  <span className="muted small">{lookLabel(g)}</span>
                  <span className="muted small">{(g.lastProcessedGrowthIndex + 1).toLocaleString()} dots</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Thumb({ controller, game, size }: { controller: GameController; game: GameState; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [pixels, setPixels] = useState<Pixel[] | null>(null);
  useEffect(() => {
    let alive = true;
    void controller.loadCollectionPixels(game.gameId).then((p) => alive && setPixels(p));
    return () => {
      alive = false;
    };
  }, [controller, game.gameId]);
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
}

function CollectionDetail({ game, number, controller, onDeleted, onRenamed }: DetailProps) {
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
      <dl className="detail-facts">
        <div>
          <dt>タイプ</dt>
          <dd>{lookLabel(game)}</dd>
        </div>
        <div>
          <dt>ドット</dt>
          <dd>{(game.lastProcessedGrowthIndex + 1).toLocaleString()}</dd>
        </div>
        <div>
          <dt>育てた日数</dt>
          <dd>{days}日</dd>
        </div>
        <div>
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
