import React from 'react';
import { Markdown } from './MarkdownViewer.jsx';

// Test component to verify HTML img tag parsing
export function MarkdownTest() {
  const testMarkdown = `
# Test README

This is a test with regular markdown image:
![Alt text](https://via.placeholder.com/300x200)

And this is the HTML img tag that should now work:
<img src="https://eclipse.dev/4diac/img/downloads/powerdby4diac_large_dark.png" width="50%">

Another HTML img with different attributes:
<img src="https://via.placeholder.com/400x300" alt="Test image" title="This is a test" width="200px" height="150px">

And some other markdown:
- List item 1
- List item 2
- **Bold text**
- *Italic text*

\`\`\`javascript
console.log("Code block test");
\`\`\`

[Link test](https://example.com)
`;

  return (
    <div style={{ padding: '20px', maxWidth: '800px' }}>
      <h2>Markdown Parser Test</h2>
      <Markdown source={testMarkdown} />
    </div>
  );
}