import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { hasSupabaseEnv, supabase } from './lib/supabase'
import './App.css'

type AppTab = 'discover' | 'matches' | 'profile'
type SwipeDirection = 'like' | 'pass'
type Gender = 'male' | 'female'

type Profile = {
  id: string
  telegram_id: string
  full_name: string
  gender: Gender
  class_name: string
  height_cm: number
  bio: string
  photo_url: string | null
}

type Match = {
  id: string
  profile_a_id: string
  profile_b_id: string
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
  photo_url: '',
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

function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<AppTab>('discover')
  const [telegramUser, setTelegramUser] = useState<TelegramUser | null>(null)
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [matches, setMatches] = useState<Profile[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [savingProfile, setSavingProfile] = useState(false)
  const [swiping, setSwiping] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [cardTransitionEnabled, setCardTransitionEnabled] = useState(false)
  const [draft, setDraft] = useState(defaultDraft)

  const currentCandidate = useMemo(() => {
    if (!myProfile) {
      return null
    }
    return candidates[currentIndex] ?? null
  }, [candidates, currentIndex, myProfile])

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
  }, [currentCandidate?.id])

  async function initialize() {
    if (!hasSupabaseEnv || !supabase) {
      setError('Не найдены переменные окружения Supabase. Проверь .env')
      setLoading(false)
      return
    }

    const tgUser = getTelegramUser()
    setTelegramUser(tgUser)
    const telegramId = tgUser?.id?.toString() ?? getOrCreateDevTelegramId()

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('telegram_id', telegramId)
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
      full_name: profile.full_name,
      gender: profile.gender,
      class_name: profile.class_name,
      height_cm: profile.height_cm,
      bio: profile.bio,
      photo_url: profile.photo_url ?? '',
    })

    await Promise.all([loadCandidates(profile.id), loadMatches(profile.id)])
    setLoading(false)
  }

  async function loadCandidates(profileId: string) {
    if (!supabase) return

    const { data: swipedRows, error: swipedError } = await supabase
      .from('swipes')
      .select('to_profile_id')
      .eq('from_profile_id', profileId)

    if (swipedError) {
      setError(swipedError.message)
      return
    }

    const excludedIds = new Set((swipedRows ?? []).map((row) => row.to_profile_id as string))

    const { data: profileRows, error: candidatesError } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', profileId)
      .limit(100)
      .returns<Profile[]>()

    if (candidatesError) {
      setError(candidatesError.message)
      return
    }

    const notSwiped = (profileRows ?? []).filter((candidate) => !excludedIds.has(candidate.id))
    setCandidates(notSwiped)
    setCurrentIndex(0)
  }

  async function loadMatches(profileId: string) {
    if (!supabase) return

    const { data: matchRows, error: matchesError } = await supabase
      .from('matches')
      .select('*')
      .or(`profile_a_id.eq.${profileId},profile_b_id.eq.${profileId}`)
      .returns<Match[]>()

    if (matchesError) {
      setError(matchesError.message)
      return
    }

    const partnerIds = (matchRows ?? []).map((match) =>
      match.profile_a_id === profileId ? match.profile_b_id : match.profile_a_id,
    )

    if (!partnerIds.length) {
      setMatches([])
      return
    }

    const { data: partnerProfiles, error: partnersError } = await supabase
      .from('profiles')
      .select('*')
      .in('id', partnerIds)
      .returns<Profile[]>()

    if (partnersError) {
      setError(partnersError.message)
      return
    }

    setMatches(partnerProfiles ?? [])
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabase) return

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

    const tgId = telegramUser?.id?.toString() ?? getOrCreateDevTelegramId()
    const payload = {
      telegram_id: tgId,
      full_name: trimmedName,
      gender: draft.gender,
      class_name: normalizedClass,
      height_cm: Math.round(draft.height_cm),
      bio: trimmedBio,
      photo_url: draft.photo_url || null,
    }

    if (myProfile) {
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', myProfile.id)
        .select('*')
        .single<Profile>()

      if (updateError) {
        setError(updateError.message)
        setSavingProfile(false)
        return
      }

      setMyProfile(data)
      setSavingProfile(false)
      return
    }

    const { data, error: createError } = await supabase
      .from('profiles')
      .insert(payload)
      .select('*')
      .single<Profile>()

    if (createError) {
      setError(createError.message)
      setSavingProfile(false)
      return
    }

    setMyProfile(data)
    await Promise.all([loadCandidates(data.id), loadMatches(data.id)])
    setSavingProfile(false)
    setActiveTab('discover')
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    if (!supabase) {
      return
    }

    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      window.alert('Можно загружать только изображения.')
      event.target.value = ''
      return
    }

    const maxSizeMb = 5
    if (file.size > maxSizeMb * 1024 * 1024) {
      window.alert('Фото слишком большое. Максимум 5 MB.')
      event.target.value = ''
      return
    }

    setUploadingPhoto(true)
    setError('')

    const tgId = telegramUser?.id?.toString() ?? getOrCreateDevTelegramId()
    const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const filePath = `${tgId}/${Date.now()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(filePath, file, { upsert: false })

    if (uploadError) {
      setError(uploadError.message)
      window.alert('Не удалось загрузить фото. Проверь bucket profile-photos и его policy в Supabase.')
      setUploadingPhoto(false)
      event.target.value = ''
      return
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('profile-photos').getPublicUrl(filePath)

    setDraft((prev) => ({ ...prev, photo_url: publicUrl }))
    setUploadingPhoto(false)
    event.target.value = ''
  }

  async function swipe(direction: SwipeDirection) {
    if (!myProfile || !currentCandidate || !supabase || swiping) {
      return
    }

    setSwiping(true)
    setError('')

    const { error: swipeError } = await supabase.from('swipes').upsert(
      {
        from_profile_id: myProfile.id,
        to_profile_id: currentCandidate.id,
        direction,
      },
      { onConflict: 'from_profile_id,to_profile_id' },
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
        .eq('from_profile_id', currentCandidate.id)
        .eq('to_profile_id', myProfile.id)
        .eq('direction', 'like')
        .maybeSingle()

      if (reciprocalError) {
        setError(reciprocalError.message)
      }

      if (reciprocalLike) {
        const [profileA, profileB] = [myProfile.id, currentCandidate.id].sort()
        const { error: matchInsertError } = await supabase.from('matches').upsert(
          {
            profile_a_id: profileA,
            profile_b_id: profileB,
          },
          { onConflict: 'profile_a_id,profile_b_id' },
        )

        if (matchInsertError) {
          setError(matchInsertError.message)
        } else {
          await loadMatches(myProfile.id)
        }
      }
    }

    const nextIndex = currentIndex + 1

    if (nextIndex >= candidates.length) {
      await loadCandidates(myProfile.id)
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
          <p className="subtitle">Найди пару с помощью свайпов, как в Tinder.</p>
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

            <label>
              Фото профиля
              <input
                type="file"
                accept="image/*"
                onChange={(event) => void uploadPhoto(event)}
                disabled={uploadingPhoto || savingProfile}
              />
            </label>

            {draft.photo_url && (
              <img
                className="profile-photo-preview"
                src={draft.photo_url}
                alt="Превью фото профиля"
              />
            )}

            {uploadingPhoto && <p className="upload-note">Загружаем фото...</p>}

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
                  alt={`Фото ${currentCandidate.full_name}`}
                />
              )}
              <div className="card-gradient" />
              <p className="badge">{currentCandidate.class_name}</p>
              <h3>{currentCandidate.full_name}</h3>
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
                      alt={`Фото ${match.full_name}`}
                    />
                  ) : (
                    <div className="match-avatar placeholder" aria-hidden="true">
                      {match.full_name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3>{match.full_name}</h3>
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

      {!telegramUser && (
        <p className="dev-note">
          Режим разработки: мини-апп открыт вне Telegram, используется локальный ID.
        </p>
      )}
    </main>
  )
}

export default App
