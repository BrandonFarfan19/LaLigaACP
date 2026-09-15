import { useEffect, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import PixelImage from './PixelImage';
import type { CarouselSlide } from '../types';
import styles from './Carousel.module.css';

interface Props {
	/** Slides to render. The component is data-driven — it knows nothing about teams. */
	slides: CarouselSlide[];
	/** Accessible name for the carousel region. */
	label?: string;
	autoplay?: boolean;
	/** Autoplay delay in ms. */
	interval?: number;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Carousel({ slides, label = 'Destacados', autoplay = true, interval = 5000 }: Props) {
	const rootRef = useRef<HTMLElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const prevRef = useRef<HTMLButtonElement>(null);
	const nextRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const root = rootRef.current;
		const track = trackRef.current;
		if (!root || !track) return;

		const slideElements = [...track.querySelectorAll<HTMLElement>('[data-carousel-slide]')];
		const canAutoplay = autoplay && !reducedMotion() && slideElements.length > 1;
		let index = 0;
		let timer: number | undefined;

		const start = () => {
			if (!canAutoplay || timer !== undefined) return;
			timer = window.setInterval(() => goTo(index + 1), interval);
		};

		const stop = () => {
			if (timer === undefined) return;
			window.clearInterval(timer);
			timer = undefined;
		};

		function goTo(target: number, userInitiated = false) {
			const next = (target + slideElements.length) % slideElements.length;
			track!.scrollTo({
				left: next * track!.clientWidth,
				behavior: reducedMotion() ? 'auto' : 'smooth',
			});
			index = next;
			// Restart the clock so a manual jump gets a full interval.
			if (userInitiated && timer !== undefined) {
				stop();
				start();
			}
		}

		const onPrev = () => goTo(index - 1, true);
		const onNext = () => goTo(index + 1, true);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'ArrowRight') goTo(index + 1, true);
			if (event.key === 'ArrowLeft') goTo(index - 1, true);
		};
		const onVisibility = () => (document.hidden ? stop() : start());

		// Scroll position is the source of truth, so touch swipes stay in sync too.
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					index = slideElements.indexOf(entry.target as HTMLElement);
				}
			},
			{ root: track, threshold: 0.6 },
		);
		slideElements.forEach((slide) => observer.observe(slide));

		const prev = prevRef.current;
		const next = nextRef.current;
		prev?.addEventListener('click', onPrev);
		next?.addEventListener('click', onNext);
		track.addEventListener('keydown', onKeyDown);

		// Never advance under the reader's hands, or in a hidden tab.
		root.addEventListener('pointerenter', stop);
		root.addEventListener('pointerleave', start);
		root.addEventListener('focusin', stop);
		root.addEventListener('focusout', start);
		track.addEventListener('pointerdown', stop);
		document.addEventListener('visibilitychange', onVisibility);

		start();

		return () => {
			stop();
			observer.disconnect();
			prev?.removeEventListener('click', onPrev);
			next?.removeEventListener('click', onNext);
			track.removeEventListener('keydown', onKeyDown);
			root.removeEventListener('pointerenter', stop);
			root.removeEventListener('pointerleave', start);
			root.removeEventListener('focusin', stop);
			root.removeEventListener('focusout', start);
			track.removeEventListener('pointerdown', stop);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [slides.length, autoplay, interval]);

	return (
		<section
			ref={rootRef}
			className={styles.carousel}
			data-carousel
			data-autoplay={autoplay ? 'true' : 'false'}
			data-interval={interval}
			aria-roledescription="carrusel"
			aria-label={label}
		>
			{/* Fixed stage light: it never moves, the crests travel through it. */}
			<div className={styles.spotlight} aria-hidden="true"></div>

			<div ref={trackRef} className={styles.track} data-carousel-track tabIndex={0}>
				{slides.map((slide, index) => {
					// Width only — forcing a square height would squash the crests that aren't square.
					const crest = (
						<div className={styles.stage}>
							<PixelImage
								className={`${styles.crest} pixelated`}
								image={slide.image}
								alt={slide.alt}
								width={96}
								densities={[2]}
								loading={index === 0 ? 'eager' : 'lazy'}
							/>
						</div>
					);

					return (
						<article
							key={slide.id}
							className={styles.slide}
							data-carousel-slide
							style={{ '--slide-accent': slide.accent ?? 'var(--color-accent)' } as CSSProperties}
							aria-roledescription="diapositiva"
							aria-label={`${index + 1} de ${slides.length}`}
						>
							{/* An `<a>` when the slide links somewhere, a plain box when
							    it doesn't — so the carousel stays usable either way. */}
							{slide.href ? (
								<Link className={styles['stage-link']} to={slide.href} aria-label={slide.hrefLabel}>
									{crest}
								</Link>
							) : (
								crest
							)}

							<div className={styles.copy}>
								{slide.eyebrow && <p className={styles.eyebrow}>{slide.eyebrow}</p>}
								{slide.title && <h2 className={styles.title}>{slide.title}</h2>}
								{slide.subtitle && <p className={styles.subtitle}>{slide.subtitle}</p>}
							</div>
						</article>
					);
				})}
			</div>

			<button ref={prevRef} className={`${styles.arrow} ${styles['arrow-prev']}`} type="button" data-carousel-prev aria-label="Anterior">
				<span aria-hidden="true">&lt;</span>
			</button>

			<button ref={nextRef} className={`${styles.arrow} ${styles['arrow-next']}`} type="button" data-carousel-next aria-label="Siguiente">
				<span aria-hidden="true">&gt;</span>
			</button>
		</section>
	);
}
