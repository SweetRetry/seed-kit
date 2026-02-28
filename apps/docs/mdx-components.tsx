import defaultComponents from 'fumadocs-ui/mdx';

export function getMDXComponents(components?: object) {
  return {
    ...defaultComponents,
    ...components,
  };
}
