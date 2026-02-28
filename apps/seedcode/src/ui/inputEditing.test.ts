import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteLeftOfCursor } from './inputEditing';

test('deletes left char when cursor is at end', () => {
  assert.deepEqual(deleteLeftOfCursor('123', 3), { value: '12', cursor: 2 });
});

test('deletes left char when cursor is on current character highlight', () => {
  assert.deepEqual(deleteLeftOfCursor('123', 2), { value: '13', cursor: 1 });
});

test('does nothing when cursor is at start', () => {
  assert.deepEqual(deleteLeftOfCursor('123', 0), { value: '123', cursor: 0 });
});
