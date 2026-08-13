import type { BabyDto, FamilyDto, MemberDto } from '@baby-care/contracts';

export function NannyFamilyView({
  family,
  baby,
  members,
}: {
  family: FamilyDto;
  baby: BabyDto;
  members: MemberDto[];
}) {
  return (
    <section className="panel" aria-labelledby="family-info-title">
      <p className="eyebrow">只读视图</p>
      <h2 id="family-info-title">家庭信息</h2>
      <dl className="facts">
        <div><dt>宝宝</dt><dd>{baby.displayName}</dd></div>
        <div><dt>家庭</dt><dd>{family.name}</dd></div>
        <div><dt>时区</dt><dd>{family.timezone}</dd></div>
        <div><dt>出生日期</dt><dd>{baby.birthDate ?? '出生后补充'}</dd></div>
      </dl>
      <h3>家庭成员</h3>
      <ul className="member-list">
        {members.map((member) => (
          <li key={member.membershipId}>
            <strong>{member.displayName}</strong>
            <span>{member.relationship === 'dad' ? 'Dad' : member.relationship === 'mom' ? 'Mom' : 'Nanny'}</span>
            <span>{member.status === 'active' ? '可用' : '已停用'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
