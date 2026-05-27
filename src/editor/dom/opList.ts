/**
 * Per-agent op-list panel.
 *
 * Shows the agent's program as a list with row-level controls
 * (delete, up, down) and an "Add op" dropdown. Visible only when
 * the editor mode is `editing-ops` for some agent.
 *
 * v1 is deliberately ugly; Phase 9 (tutorial) is when ergonomics
 * really matter.
 */

import type { AgentId, Op } from '../../engine/types';
import type { EditorAction, EditorState } from '../state';

const OP_LABELS: Record<Op['kind'], string> = {
  MOVE: 'MOVE',
  GRAB: 'GRAB',
  DROP: 'DROP',
  WAIT: 'WAIT',
  SENSE: 'SENSE',
};

export function mountOpList(
  container: HTMLElement,
  getState: () => EditorState,
  dispatch: (a: EditorAction) => void,
): { update: () => void; destroy: () => void } {
  container.classList.add('op-list');
  container.style.cssText = `
    padding: 8px;
    background: var(--surface);
    border-radius: 6px;
    margin: 8px 0;
    min-height: 80px;
    font-family: ui-monospace, monospace;
    color: var(--fg);
  `;

  function update(): void {
    const s = getState();
    container.replaceChildren();
    const editingAgent = s.mode.kind === 'editing-ops' ? s.mode.agentId : null;

    // Per-agent open-editor buttons
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; gap: 8px; margin-bottom: 8px;';
    for (const a of s.puzzle.agents) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset['agentId'] = a.id;
      btn.textContent = `Edit ops: ${a.id}`;
      btn.style.cssText = `
        padding: 4px 10px; background: ${a.id === editingAgent ? 'var(--accent)' : 'var(--bg)'};
        color: ${a.id === editingAgent ? 'var(--bg)' : 'var(--fg)'};
        border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;
      `;
      btn.addEventListener('click', () =>
        dispatch({ type: 'BEGIN_OP_EDIT_FOR_AGENT', agentId: a.id }),
      );
      header.appendChild(btn);

      const pathBtn = document.createElement('button');
      pathBtn.type = 'button';
      pathBtn.dataset['pathAgent'] = a.id;
      const drawing = s.mode.kind === 'drawing-path' && s.mode.agentId === a.id;
      pathBtn.textContent = drawing ? `Drawing path...` : `Edit path: ${a.id}`;
      pathBtn.style.cssText = `
        padding: 4px 10px; background: ${drawing ? 'var(--accent)' : 'var(--bg)'};
        color: ${drawing ? 'var(--bg)' : 'var(--fg)'};
        border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;
      `;
      pathBtn.addEventListener('click', () =>
        dispatch({ type: 'BEGIN_PATH_FOR_AGENT', agentId: a.id }),
      );
      header.appendChild(pathBtn);
    }
    container.appendChild(header);

    if (!editingAgent) {
      // The hint text is hardcoded developer help — no LLM data flows in.
      // Even so, we build it with createElement + textContent to honor
      // CLAUDE.md invariant #6 ("never `innerHTML`"). The blast radius if
      // anyone later substitutes manifest text here is zero this way.
      const hint = document.createElement('div');
      hint.style.cssText =
        'color: var(--muted); font-family: sans-serif; font-size: 12px; line-height: 1.6;';
      const rows: ReadonlyArray<readonly [string, string]> = [
        ['Place tiles:', ' pick a kind from the palette → click cells. R rotates while placing.'],
        [
          'Edit/delete tiles:',
          ' press Esc to leave placing mode → click a tile to select → R rotates, Backspace deletes.',
        ],
        [
          'Path drawing:',
          ' click Edit path: a1 → click cells to append vertices, Z undoes, Enter commits, Esc cancels.',
        ],
        ['Ops:', ' click Edit ops: a1 → use the dropdown + Add to append; ↑/↓/× per row.'],
      ];
      for (let i = 0; i < rows.length; i++) {
        const [label, body] = rows[i]!;
        const row = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = label;
        row.appendChild(strong);
        row.appendChild(document.createTextNode(body));
        hint.appendChild(row);
      }
      container.appendChild(hint);
      return;
    }

    renderProgramFor(editingAgent, s, container, dispatch);
  }

  update();
  return {
    update,
    destroy() {
      container.replaceChildren();
    },
  };
}

function renderProgramFor(
  agentId: AgentId,
  s: EditorState,
  container: HTMLElement,
  dispatch: (a: EditorAction) => void,
): void {
  const program = s.draft.programs[agentId] ?? [];
  const agent = s.puzzle.agents.find((a) => a.id === agentId);
  const limit = agent?.maxOps ?? 0;

  const heading = document.createElement('div');
  heading.textContent = `${agentId} — program (${program.length}/${limit}):`;
  heading.style.cssText = 'margin-bottom: 6px; font-size: 13px;';
  container.appendChild(heading);

  for (let i = 0; i < program.length; i++) {
    const row = document.createElement('div');
    row.dataset['opIndex'] = String(i);
    row.style.cssText =
      'display: flex; gap: 6px; align-items: center; padding: 2px 0; font-size: 13px;';
    const op = program[i]!;
    const label = document.createElement('span');
    label.textContent = `${i.toString().padStart(2, '0')}  ${describeOp(op)}`;
    label.style.cssText = 'flex: 1;';
    row.appendChild(label);
    row.appendChild(makeBtn('↑', () => dispatch({ type: 'MOVE_OP_UP', index: i })));
    row.appendChild(makeBtn('↓', () => dispatch({ type: 'MOVE_OP_DOWN', index: i })));
    row.appendChild(makeBtn('×', () => dispatch({ type: 'DELETE_OP', index: i })));
    container.appendChild(row);
  }

  // Append-op dropdown
  if (program.length < limit) {
    const adder = document.createElement('div');
    adder.style.cssText = 'margin-top: 8px; display: flex; gap: 6px; align-items: center;';
    const select = document.createElement('select');
    select.dataset['role'] = 'append-op';
    select.style.cssText =
      'background: var(--bg); color: var(--fg); border: 1px solid var(--muted);';
    for (const kind of s.puzzle.availableOps) {
      const o = document.createElement('option');
      o.value = kind;
      o.textContent = OP_LABELS[kind];
      select.appendChild(o);
    }
    adder.appendChild(select);
    const addBtn = makeBtn('Add', () => {
      const kind = select.value as Op['kind'];
      const op: Op =
        kind === 'SENSE'
          ? { kind: 'SENSE', expects: 'alpha', then: { kind: 'WAIT' }, otherwise: { kind: 'WAIT' } }
          : { kind };
      dispatch({ type: 'APPEND_OP', op });
    });
    adder.appendChild(addBtn);
    container.appendChild(adder);
  }
}

function describeOp(op: Op): string {
  if (op.kind === 'SENSE') {
    return `SENSE(${op.expects}) ? ${op.then.kind} : ${op.otherwise.kind}`;
  }
  return op.kind;
}

function makeBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = `
    padding: 2px 8px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;
  `;
  b.addEventListener('click', onClick);
  return b;
}
