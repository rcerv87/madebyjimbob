import { Link } from 'react-router-dom';
import { BRAND, SOCIALS } from '../brand.js';

// Top of the Videos page: JimBob's banner art, when he's live, and everywhere else to find him.
export default function BrandHero() {
  return (
    <section className="brand-hero" style={{ backgroundImage: `url(${BRAND.headerArt})` }}>
      <div className="brand-hero-inner">
        <img className="hero-avatar" src={BRAND.avatar} alt="" width="84" height="84" />
        <div className="hero-text">
          <h1>{BRAND.name}</h1>
          <p>{BRAND.schedule}</p>
          <div className="hero-links">
            <Link to="/shop" className="hero-btn primary">
              Shop
            </Link>
            <Link to="/art" className="hero-btn">
              Art
            </Link>
          </div>
        </div>
      </div>
      <nav className="socials" aria-label="JimBob elsewhere">
        {SOCIALS.map((s) => (
          <a key={s.key} href={s.url} target="_blank" rel="noopener noreferrer">
            {s.label}
          </a>
        ))}
      </nav>
    </section>
  );
}
