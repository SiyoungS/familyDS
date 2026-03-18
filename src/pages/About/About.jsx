const AboutPage = () => {
  return (
    <div className="flex flex-1">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">프로젝트 소개</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          `family`는 가족 구성원 간 관계를 입력하고 시각화하는 웹 프로젝트를 위한 기본 템플릿입니다.
          현재는 라우팅과 스타일 시스템이 준비된 상태이며, 이후 가계도 화면과 데이터 처리 로직을 확장하면
          됩니다.
        </p>
      </div>
    </div>
  )
}

export default AboutPage
