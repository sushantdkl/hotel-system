import { getPublicBrand, getPublicGallery, getPublicVideos } from '@/lib/public-content';
import PageHead from '@/components/public/page-head';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const brand = await getPublicBrand();
  return { title: 'Gallery', description: `Photos and videos from ${brand.name}.`, alternates: { canonical: '/gallery' } };
}

export default async function GalleryPage() {
  const [gallery, videos] = await Promise.all([getPublicGallery(), getPublicVideos()]);
  return (
    <>
      <PageHead title={gallery.heading} lead={gallery.lead} />
      <div className="rc-wrap rc-page-body">
        <div className="rc-masonry">
          {gallery.items.map((item, index) => (
            <figure key={`${item.url}-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt={item.alt} loading={index < 4 ? 'eager' : 'lazy'} />
              {item.title ? <figcaption>{item.title}</figcaption> : null}
            </figure>
          ))}
        </div>

        {videos.items.length ? (
          <section style={{ marginTop: 'clamp(3.5rem, 8vw, 5.5rem)' }} aria-labelledby="videos-title">
            <div className="rc-section-head">
              <div>
                <h2 id="videos-title" className="rc-h2">{videos.heading}</h2>
                {videos.lead ? <p className="rc-lead">{videos.lead}</p> : null}
              </div>
            </div>
            <div className="rc-videos">
              {videos.items.map((video, index) => (
                <article key={`${video.src}-${index}`} className="rc-video">
                  {video.kind === 'link' ? (
                    <a href={video.src} target="_blank" rel="noopener noreferrer" className="rc-btn rc-btn--ghost dsp-focus">Watch {video.title || 'the video'}</a>
                  ) : (
                    <div className="rc-video-frame">
                      {video.kind === 'youtube'
                        ? <iframe src={video.src} title={video.title || videos.heading} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                        : <video src={video.src} controls preload="metadata" playsInline />}
                    </div>
                  )}
                  {video.kind !== 'link' && video.title ? <h3 className="rc-h3">{video.title}</h3> : null}
                  {video.description ? <p>{video.description}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
