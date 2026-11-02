type TerminalListener = (command: string) => void;

const listeners = new Set<TerminalListener>();
const pending: string[] = [];

/** Queues a command for the terminal panel, creating a session if needed. */
export function requestTerminalCommand(command: string): void {
  if (listeners.size === 0) {
    pending.push(command);
    return;
  }
  for (const listener of listeners) listener(command);
}

export function subscribeTerminalCommands(listener: TerminalListener): () => void {
  listeners.add(listener);
  while (pending.length > 0) {
    const command = pending.shift();
    if (command) listener(command);
  }
  return () => {
    listeners.delete(listener);
  };
}
