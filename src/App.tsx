import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { hasSupabaseEnv, supabase } from './lib/supabase'
import './App.css'

type AppTab = 'discover' | 'matches' | 'profile'
type SwipeDirection = 'like' | 'pass'
type Gender = 'male' | 'female'

type Profile = {
  id: number
  tg_id: string
  username: string
  first_name: string
  class_name: string
  gender: Gender
  height_cm: number
  bio: string
  is_active: boolean
  photo_url?: string | null
}

type Match = {
  id: number
  user_a: string
  user_b: string
}

type TelegramUser = {
  id: number
  first_name: string
  last_name?: string
  username?: string
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void
        expand: () => void
        initDataUnsafe?: {
          user?: TelegramUser
        }
      }
    }
  }
}

const defaultDraft = {
  full_name: '',
  gender: 'male' as Gender,
  class_name: '',
  height_cm: 170,
  bio: '',
}

const genderLabels: Record<Gender, string> = {
  male: 'Парень',
  female: 'Девушка',
}

const SWIPE_TRIGGER_PX = 90

function getTelegramUser(): TelegramUser | null {
  return window.Telegram?.WebApp?.initDataUnsafe?.user ?? null
}

function getOrCreateDevTelegramId(): string {
  const key = 'waltzbot_dev_telegram_id'
  const fromStorage = localStorage.getItem(key)

  if (fromStorage) {
    return fromStorage
  }

  const generated = `dev_${Math.floor(Math.random() * 1_000_000_000)}`
  localStorage.setItem(key, generated)
  return generated
}

function isValidGraduationClass(value: string): boolean {
  return /^12[ABCDEKLFM]$/.test(value)
}

function profileDisplayName(profile: Profile): string {
  const fromFirstName = profile.first_name?.trim()
  if (fromFirstName) {
    return fromFirstName
  }

  const fromUsername = profile.username?.trim()
  if (fromUsername) {
    return fromUsername.startsWith('@') ? fromUsername : `@${fromUsername}`
  }

  return profile.tg_id
}

function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<AppTab>('discover')
  const [telegramUser, setTelegramUser] = useState<TelegramUser | null>(null)
  const [myTgId, setMyTgId] = useState('')
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [matches, setMatches] = useState<Profile[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [savingProfile, setSavingProfile] = useState(false)
  const [swiping, setSwiping] = useState(false)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [cardTransitionEnabled, setCardTransitionEnabled] = useState(false)
  const [draft, setDraft] = useState(defaultDraft)

  const currentCandidate = useMemo(() => {
    if (!myTgId) {
      return null
    }
    return candidates[currentIndex] ?? null
  }, [candidates, currentIndex, myTgId])

  const swipeIntent: SwipeDirection | null = dragX > 0 ? 'like' : dragX < 0 ? 'pass' : null
  const swipePower = Math.min(Math.abs(dragX) / SWIPE_TRIGGER_PX, 1)
  const cardTransform = `translateX(${dragX}px) rotate(${dragX / 22}deg)`

  useEffect(() => {
    window.Telegram?.WebApp?.ready()
    window.Telegram?.WebApp?.expand()
    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setDragX(0)
    setIsDragging(false)
    setTouchStartX(null)
    setCardTransitionEnabled(false)
  }, [currentCandidate?.tg_id])

  async function initialize() {
    if (!hasSupabaseEnv || !supabase) {
      setError('Не найдены переменные окружения Supabase. Проверь .env')
      setLoading(false)
      return
    }

    const tgUser = getTelegramUser()
    setTelegramUser(tgUser)
    const telegramId = tgUser?.id?.toString() ?? getOrCreateDevTelegramId()
    setMyTgId(telegramId)

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('tg_id', telegramId)
      .maybeSingle<Profile>()

    if (profileError) {
      setError(profileError.message)
      setLoading(false)
      return
    }

    if (!profile) {
      const fullName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ')
      setDraft((prev) => ({ ...prev, full_name: fullName }))
      setMyProfile(null)
      setLoading(false)
      return
    }

    setMyProfile(profile)
    setDraft({
      full_name: profile.first_name || profile.username || '',
      gender: profile.gender,
      class_name: profile.class_name,
      height_cm: profile.height_cm,
      bio: profile.bio,
    })

    await Promise.all([loadCandidates(telegramId), loadMatches(telegramId)])
    setLoading(false)
  }

  async function loadCandidates(telegramId: string) {
    if (!supabase) return

    const { data: swipedRows, error: swipedError } = await supabase
      .from('swipes')
      .select('to_tg_id')
      .eq('from_tg_id', telegramId)

    if (swipedError) {
      setError(swipedError.message)
      return
    }

    const excludedIds = new Set((swipedRows ?? []).map((row) => row.to_tg_id as string))

    const { data: profileRows, error: candidatesError } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .neq('tg_id', telegramId)
      .limit(100)
      .returns<Profile[]>()

    if (candidatesError) {
      setError(candidatesError.message)
      return
    }

    const notSwiped = (profileRows ?? []).filter((candidate) => !excludedIds.has(candidate.tg_id))
    setCandidates(notSwiped)
    setCurrentIndex(0)
  }

  async function loadMatches(telegramId: string) {
    if (!supabase) return

    const { data: matchRows, error: matchesError } = await supabase
      .from('matches')
      .select('*')
      .or(`user_a.eq.${telegramId},user_b.eq.${telegramId}`)
      .returns<Match[]>()

    if (matchesError) {
      setError(matchesError.message)
      return
    }

    const partnerIds = (matchRows ?? []).map((match) =>
      match.user_a === telegramId ? match.user_b : match.user_a,
    )

    if (!partnerIds.length) {
      setMatches([])
      return
    }

    const { data: partnerProfiles, error: partnersError } = await supabase
      .from('profiles')
      .select('*')
      .in('tg_id', partnerIds)
      .returns<Profile[]>()

    if (partnersError) {
      setError(partnersError.message)
      return
    }

    setMatches(partnerProfiles ?? [])
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabase || !myTgId) return

    const trimmedName = draft.full_name.trim()
    const normalizedClass = draft.class_name.trim().toUpperCase().replace(/\s+/g, '')
    const trimmedBio = draft.bio.trim()

    if (!trimmedName || !normalizedClass || !trimmedBio) {
      setError('Заполни имя, класс и описание.')
      return
    }

    if (!isValidGraduationClass(normalizedClass)) {
      window.alert('Введи правильный класс: только 12A, 12B, 12C, 12D, 12E, 12K, 12L, 12F или 12M.')
      setError('Некорректный класс. Доступны только 12A/B/C/D/E/K/L/F/M.')
      return
    }

    if (!Number.isFinite(draft.height_cm) || draft.height_cm < 140 || draft.height_cm > 210) {
      window.alert('Рост должен быть числом от 140 до 210 см.')
      setError('Некорректный рост. Введи значение от 140 до 210 см.')
      return
    }

    setSavingProfile(true)
    setError('')

    const payload = {
      tg_id: myTgId,
      username: telegramUser?.username ?? myProfile?.username ?? '',
      first_name: trimmedName,
      class_name: normalizedClass,
      gender: draft.gender,
      height_cm: Math.round(draft.height_cm),
      bio: trimmedBio,
      is_active: true,
    }

    const { data, error: upsertError } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'tg_id' })
      .select('*')
      .single<Profile>()

    if (upsertError) {
      setError(upsertError.message)
      setSavingProfile(false)
      return
    }

    setMyProfile(data)
    await Promise.all([loadCandidates(myTgId), loadMatches(myTgId)])
    setSavingProfile(false)
    setActiveTab('discover')
  }

  async function swipe(direction: SwipeDirection) {
    if (!myTgId || !currentCandidate || !supabase || swiping) {
      return
    }

    setSwiping(true)
    setError('')

    const { error: swipeError } = await supabase.from('swipes').upsert(
      {
        from_tg_id: myTgId,
        to_tg_id: currentCandidate.tg_id,
        action: direction,
      },
      { onConflict: 'from_tg_id,to_tg_id' },
    )

    if (swipeError) {
      setError(swipeError.message)
      setSwiping(false)
      return
    }

    if (direction === 'like') {
      const { data: reciprocalLike, error: reciprocalError } = await supabase
        .from('swipes')
        .select('id')
        .eq('from_tg_id', currentCandidate.tg_id)
        .eq('to_tg_id', myTgId)
        .eq('action', 'like')
        .maybeSingle()

      if (reciprocalError) {
        setError(reciprocalError.message)
      }

      if (reciprocalLike) {
        const [userA, userB] = [myTgId, currentCandidate.tg_id].sort()
        const { error: matchInsertError } = await supabase.from('matches').upsert(
          {
            user_a: userA,
            user_b: userB,
          },
          { onConflict: 'user_a,user_b' },
        )

        if (matchInsertError) {
          setError(matchInsertError.message)
        } else {
          await loadMatches(myTgId)
        }
      }
    }

    const nextIndex = currentIndex + 1

    if (nextIndex >= candidates.length) {
      await loadCandidates(myTgId)
    } else {
      setCurrentIndex(nextIndex)
    }

    setSwiping(false)
  }

  function onCardPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!currentCandidate || swiping) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    setTouchStartX(event.clientX - dragX)
    setIsDragging(true)
    setCardTransitionEnabled(false)
  }

  function onCardPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!isDragging || touchStartX === null) {
      return
    }

    setDragX(event.clientX - touchStartX)
  }

  function finishDrag() {
    if (!isDragging) {
      return
    }

    setIsDragging(false)
    setTouchStartX(null)

    if (Math.abs(dragX) >= SWIPE_TRIGGER_PX) {
      void triggerSwipe(dragX > 0 ? 'like' : 'pass')
      return
    }

    setCardTransitionEnabled(true)
    setDragX(0)
    window.setTimeout(() => {
      setCardTransitionEnabled(false)
    }, 220)
  }

  async function triggerSwipe(direction: SwipeDirection) {
    if (!currentCandidate || swiping) {
      return
    }

    setCardTransitionEnabled(true)
    setDragX((direction === 'like' ? 1 : -1) * window.innerWidth)

    await new Promise((resolve) => {
      window.setTimeout(resolve, 170)
    })

    await swipe(direction)
    setDragX(0)
    setCardTransitionEnabled(false)
  }

  const isFormVisible = activeTab === 'profile' || !myProfile

  if (loading) {
    return <main className="app-shell">Загрузка...</main>
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Waltzbot</p>
          <h1>Выпускной вальс</h1>
          <p className="subtitle">Найди пару с помощью свайпов</p>
        </div>
      </header>

      <nav className="tabs" aria-label="Навигация">
        <button
          className={activeTab === 'discover' ? 'active' : ''}
          onClick={() => setActiveTab('discover')}
          disabled={!myProfile}
        >
          Свайпы
        </button>
        <button
          className={activeTab === 'matches' ? 'active' : ''}
          onClick={() => setActiveTab('matches')}
          disabled={!myProfile}
        >
          Мэтчи ({matches.length})
        </button>
        <button
          className={activeTab === 'profile' || !myProfile ? 'active' : ''}
          onClick={() => setActiveTab('profile')}
        >
          Моя анкета
        </button>
      </nav>

      {error && <p className="error-box">{error}</p>}

      {isFormVisible && (
        <section className="panel form-panel">
          <h2>{myProfile ? 'Редактировать анкету' : 'Создай анкету'}</h2>
          <form onSubmit={saveProfile} className="profile-form">
            <label>
              Имя и фамилия
              <input
                value={draft.full_name}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, full_name: event.target.value }))
                }
                required
                placeholder="Например: Амирали Сеитов"
              />
            </label>

            <div className="row-2">
              <label>
                Пол
                <select
                  value={draft.gender}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      gender: event.target.value as Gender,
                    }))
                  }
                >
                  <option value="male">Парень</option>
                  <option value="female">Девушка</option>
                </select>
              </label>

              <label>
                Класс
                <input
                  value={draft.class_name}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      class_name: event.target.value.toUpperCase(),
                    }))
                  }
                  required
                  placeholder="12A"
                  maxLength={3}
                />
              </label>
            </div>

            <label>
              Рост (см)
              <input
                type="number"
                min={140}
                max={210}
                value={draft.height_cm}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    height_cm: Number(event.target.value),
                  }))
                }
                required
                placeholder="170"
              />
            </label>

            <label>
              О себе
              <textarea
                value={draft.bio}
                onChange={(event) => setDraft((prev) => ({ ...prev, bio: event.target.value }))}
                required
                rows={4}
                placeholder="Музыка, хобби, какой стиль танца нравится..."
              />
            </label>

            <button type="submit" className="primary" disabled={savingProfile}>
              {savingProfile ? 'Сохраняем...' : 'Сохранить анкету'}
            </button>
          </form>
        </section>
      )}

      {!isFormVisible && activeTab === 'discover' && (
        <section className="panel">
          <h2>Кого ты выберешь для вальса?</h2>
          {currentCandidate ? (
            <article
              className="candidate-card"
              onPointerDown={onCardPointerDown}
              onPointerMove={onCardPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              style={{
                transform: cardTransform,
                transition: cardTransitionEnabled ? 'transform 220ms ease' : 'none',
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
            >
              <div
                className={`swipe-indicator like ${swipeIntent === 'like' ? 'show' : ''}`}
                style={{ opacity: swipeIntent === 'like' ? swipePower : 0 }}
              >
                LIKE
              </div>
              <div
                className={`swipe-indicator pass ${swipeIntent === 'pass' ? 'show' : ''}`}
                style={{ opacity: swipeIntent === 'pass' ? swipePower : 0 }}
              >
                PASS
              </div>
              {currentCandidate.photo_url && (
                <img
                  className="candidate-photo"
                  src={currentCandidate.photo_url}
                  alt={`Фото ${profileDisplayName(currentCandidate)}`}
                />
              )}
              <div className="card-gradient" />
              <p className="badge">{currentCandidate.class_name}</p>
              <h3>{profileDisplayName(currentCandidate)}</h3>
              <p className="meta">
                {genderLabels[currentCandidate.gender]} · {currentCandidate.height_cm} см
              </p>
              <p className="bio">{currentCandidate.bio}</p>
            </article>
          ) : (
            <p className="empty-state">
              Кандидаты закончились. Позови друзей заполнить анкеты или зайди позже.
            </p>
          )}

          <div className="swipe-actions">
            <button
              type="button"
              onClick={() => void triggerSwipe('pass')}
              disabled={!currentCandidate || swiping}
              className="ghost"
            >
              Пропустить
            </button>
            <button
              type="button"
              onClick={() => void triggerSwipe('like')}
              disabled={!currentCandidate || swiping}
              className="primary"
            >
              Лайк
            </button>
          </div>
        </section>
      )}

      {!isFormVisible && activeTab === 'matches' && (
        <section className="panel">
          <h2>Твои мэтчи</h2>
          {matches.length === 0 ? (
            <p className="empty-state">Пока нет мэтчей. Продолжай свайпать.</p>
          ) : (
            <div className="match-list">
              {matches.map((match) => (
                <article key={match.id} className="match-item">
                  {match.photo_url ? (
                    <img
                      className="match-avatar"
                      src={match.photo_url}
                      alt={`Фото ${profileDisplayName(match)}`}
                    />
                  ) : (
                    <div className="match-avatar placeholder" aria-hidden="true">
                      {profileDisplayName(match).slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3>{profileDisplayName(match)}</h3>
                    <p>
                      {match.class_name} · {match.height_cm} см · {genderLabels[match.gender]}
                    </p>
                  </div>
                  <span className="heart">❤</span>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

    </main>
  )
}

export default App
