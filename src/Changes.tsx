import { useState } from "react";
import { Prose } from "./Chat.tsx";
import { Icon, PlainMark, Spinner } from "./ui.tsx";

/** A file a reply changed, as the engine gives it: its path in the project, how it changed, and by how many lines - or that it is binary. */
export type ChangedFile = { path: string; status: "added" | "modified" | "deleted"; added?: number; removed?: number; binary?: true };

/** A folder of the changed files: its name - a chain of folders with nothing else in them said as one, resources/img - and what is in it. */
type Folder = { name: string; folders: Folder[]; files: ChangedFile[] };

function treeOf(files: ChangedFile[]): Folder {
  const root: Folder = { name: "", folders: [], files: [] };
  for (const file of files) {
    let at = root;
    for (const part of file.path.split("/").slice(0, -1)) {
      let next = at.folders.find((folder) => folder.name === part);
      if (next === undefined) at.folders.push((next = { name: part, folders: [], files: [] }));
      at = next;
    }
    at.files.push(file);
  }
  const joined = (folder: Folder): Folder => {
    let now = folder;
    while (now.files.length === 0 && now.folders.length === 1) now = { ...now.folders[0]!, name: `${now.name}/${now.folders[0]!.name}` };
    return { ...now, folders: now.folders.map(joined) };
  };
  return { ...root, folders: root.folders.map(joined) };
}

/** More files than this, and a card starts folded. */
const MANY = 12;

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const sum = (files: ChangedFile[], key: "added" | "removed") => files.reduce((total, file) => total + (file[key] ?? 0), 0);

/** How many lines went in and out: green and red, as a diff colours them. */
function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="changes-counts">
      <span className="added">+{added}</span> <span className="removed">−{removed}</span>
    </span>
  );
}

/**
 * What a reply of turri's changed of the ***plain - its .plain files and the resources they link - as T3 Code shows a
 * turn's: under the reply, how many files and lines, and the files as a tree, each with its count. A file opens into its
 * diff - between the project as the reply began and as it ended - and is opened in the window from its row. Kept in the
 * chat: it is there when the project is opened again, its diffs as long as this machine keeps them.
 */
export function ReplyChanges({ from, to, files, onOpen }: { from: string; to: string; files: ChangedFile[]; onOpen?: (path: string) => void }) {
  // Open, unless there are so many files they would fill the chat: then its head says how many, and a click opens it.
  const [open, setOpen] = useState(files.length <= MANY);
  const count = files.length === 1 ? "1 file changed" : `${files.length} files changed`;
  return (
    <section className="msg changes" aria-label={`what this reply changed: ${count}`}>
      <button className="changes-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? "open" : ""}`}>
          <Icon name="chevron" size={12} />
        </span>
        <span className="changes-title">{count}</span>
        <Counts added={sum(files, "added")} removed={sum(files, "removed")} />
      </button>
      {open && (
        <div className="changes-tree" role="tree">
          <FolderRows folder={treeOf(files)} depth={0} from={from} to={to} onOpen={onOpen} />
        </div>
      )}
    </section>
  );
}

function FolderRows({ folder, depth, from, to, onOpen }: { folder: Folder; depth: number; from: string; to: string; onOpen?: (path: string) => void }) {
  return (
    <>
      {folder.folders.map((inner) => (
        <div key={inner.name} role="group">
          <div className="changes-row folder" role="treeitem" style={{ "--depth": depth } as React.CSSProperties}>
            <Icon name="folder" size={13} />
            <span className="changes-name">{inner.name}</span>
          </div>
          <FolderRows folder={inner} depth={depth + 1} from={from} to={to} onOpen={onOpen} />
        </div>
      ))}
      {folder.files.map((file) => (
        <FileRow key={file.path} file={file} depth={depth} from={from} to={to} onOpen={onOpen} />
      ))}
    </>
  );
}

/** What a file's diff says when there are no lines to show. */
const NO_LINES = { binary: "a binary file - no lines to compare", lost: "this change is no longer kept on this machine", same: "only its mode changed" };

function FileRow({ file, depth, from, to, onOpen }: { file: ChangedFile; depth: number; from: string; to: string; onOpen?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  // The diff, read once it is first opened: undefined until then, null while it is read.
  const [diff, setDiff] = useState<string | null | undefined>(undefined);
  const toggle = () => {
    setOpen(!open);
    if (diff !== undefined || file.binary) return;
    setDiff(null);
    window.turri
      .call<string | null>("replyDiff", { from, to, path: file.path })
      .then((text) => setDiff(text === null ? NO_LINES.lost : text), () => setDiff(NO_LINES.lost));
  };
  const plain = file.path.endsWith(".plain");
  const name = nameOf(file.path);
  return (
    <div className={`changes-file ${file.status}`} role="treeitem" aria-expanded={open}>
      <div className="changes-row" style={{ "--depth": depth } as React.CSSProperties}>
        <button className="changes-file-open" onClick={toggle} title={open ? "put the diff away" : `the diff of ${file.path}`}>
          {plain ? <PlainMark size={12} /> : <Icon name="file" size={13} />}
          <span className="changes-name">{name}</span>
          {file.status !== "modified" && <span className="changes-status">{file.status}</span>}
          {file.binary ? <span className="changes-counts muted">binary</span> : <Counts added={file.added ?? 0} removed={file.removed ?? 0} />}
        </button>
        {onOpen !== undefined && file.status !== "deleted" && (
          <button className="icon-button" onClick={() => onOpen(file.path)} title={`open ${file.path}`} aria-label={`open ${name}`}>
            <Icon name="forward" size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="changes-diff">
          {file.binary ? <p className="muted">{NO_LINES.binary}</p> : diff === undefined || diff === null ? <Spinner /> : <DiffOf text={diff} plain={plain} />}
        </div>
      )}
    </div>
  );
}

/** A file's diff, from its first hunk - the row says which file - coloured by the ***plain grammar when it is a .plain file's. */
function DiffOf({ text, plain }: { text: string; plain: boolean }) {
  const hunks = text.indexOf("\n@@");
  if (!text.startsWith("diff ") && !text.startsWith("@@")) return <p className="muted">{text}</p>;
  const body = text.startsWith("@@") ? text : hunks === -1 ? "" : text.slice(hunks + 1);
  if (body.trim() === "") return <p className="muted">{/^Binary files /m.test(text) ? NO_LINES.binary : NO_LINES.same}</p>;
  return <Prose text={"```diff" + (plain ? " plain" : "") + "\n" + body.replace(/\n$/, "") + "\n```"} />;
}
