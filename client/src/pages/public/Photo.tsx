// A photo box on the public website. Files live in public/site-photos (sources and licenses in
// CREDITS.md there).
export function Photo({ file, alt, size }: { file: string; alt: string; size: 'hero' | 'split' | 'card' }) {
  return (
    <div className={`site-picture site-picture-${size}`}>
      <img src={`/site-photos/${file}.jpg`} alt={alt} loading="lazy" decoding="async" />
    </div>
  )
}
