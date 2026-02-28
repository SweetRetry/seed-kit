export interface InputEditState {
  value: string;
  cursor: number;
}

/**
 * Delete the character immediately left of the cursor block.
 * The cursor block can sit on a character or at end-of-line blank space.
 */
export function deleteLeftOfCursor(value: string, cursor: number): InputEditState {
  if (cursor <= 0) {
    return { value, cursor: 0 };
  }

  return {
    value: value.slice(0, cursor - 1) + value.slice(cursor),
    cursor: cursor - 1,
  };
}
