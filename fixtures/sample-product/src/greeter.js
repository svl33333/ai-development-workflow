export function greet(name) {
  if (!name?.trim()) throw new Error('name is required');
  return `Hello, ${name.trim()}!`;
}
