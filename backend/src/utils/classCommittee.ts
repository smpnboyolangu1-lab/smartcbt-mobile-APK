import prisma from './db';
import { normalizeClassVariations } from './classHelper';

export interface ClassCommitteeInfo {
  leaderName: string;
  leaderId?: string;
  viceLeaderName: string;
  viceLeaderId?: string;
  secretaryName: string;
  secretaryId?: string;
  secretary2Name?: string;
  secretary2Id?: string;
  treasurerName: string;
  treasurerId?: string;
  treasurer2Name?: string;
  treasurer2Id?: string;
}

// In-memory cache with short TTL (15s) to allow instant sync when edited from portal
interface CacheEntry {
  data: ClassCommitteeInfo;
  timestamp: number;
}
const committeeCache: Record<string, CacheEntry> = {};

/**
 * Invalidate cache saat admin/operator mengubah susunan pengurus di portal
 */
export function invalidateCommitteeCache(className?: string) {
  if (className) {
    delete committeeCache[className.trim().toUpperCase()];
  } else {
    for (const k in committeeCache) {
      delete committeeCache[k];
    }
  }
}

/**
 * Mendapatkan susunan pengurus kelas (Ketua, Wakil, Sekretaris, Bendahara) riil dari DB
 */
export async function getClassCommittee(className: string): Promise<ClassCommitteeInfo> {
  const normClass = (className || 'VII-A').trim();
  const cacheKey = normClass.toUpperCase();

  const now = Date.now();
  if (committeeCache[cacheKey] && (now - committeeCache[cacheKey].timestamp < 15000)) {
    return committeeCache[cacheKey].data;
  }

  try {
    // 1. Cari data kelas beserta plotting JSON officers
    const variations = normalizeClassVariations(normClass);
    const cls = await prisma.class.findFirst({
      where: {
        OR: [
          { name: { in: variations } },
          { id: { in: variations } }
        ]
      }
    });

    let leaderName = '-';
    let leaderId: string | undefined;
    let viceLeaderName = '-';
    let viceLeaderId: string | undefined;
    let secretaryName = '-';
    let secretaryId: string | undefined;
    let secretary2Name: string | undefined;
    let secretary2Id: string | undefined;
    let treasurerName = '-';
    let treasurerId: string | undefined;
    let treasurer2Name: string | undefined;
    let treasurer2Id: string | undefined;

    if (cls && cls.officers) {
      try {
        const off = JSON.parse(cls.officers);
        const officerIds = [
          off.ketuaId,
          off.wakilId,
          off.sekretaris1Id || off.sekretarisId,
          off.sekretaris2Id,
          off.bendahara1Id || off.bendaharaId,
          off.bendahara2Id
        ].filter(Boolean);

        if (officerIds.length > 0) {
          const officerUsers = await prisma.user.findMany({
            where: { id: { in: officerIds }, isActive: true },
            select: { id: true, name: true, classRole: true }
          });
          const userMap = new Map(officerUsers.map(u => [u.id, u]));

          if (off.ketuaId && userMap.has(off.ketuaId)) {
            leaderName = userMap.get(off.ketuaId)!.name;
            leaderId = off.ketuaId;
          }
          if (off.wakilId && userMap.has(off.wakilId)) {
            viceLeaderName = userMap.get(off.wakilId)!.name;
            viceLeaderId = off.wakilId;
          }
          const sec1Id = off.sekretaris1Id || off.sekretarisId;
          if (sec1Id && userMap.has(sec1Id)) {
            secretaryName = userMap.get(sec1Id)!.name;
            secretaryId = sec1Id;
          }
          if (off.sekretaris2Id && userMap.has(off.sekretaris2Id)) {
            secretary2Name = userMap.get(off.sekretaris2Id)!.name;
            secretary2Id = off.sekretaris2Id;
          }
          const ben1Id = off.bendahara1Id || off.bendaharaId;
          if (ben1Id && userMap.has(ben1Id)) {
            treasurerName = userMap.get(ben1Id)!.name;
            treasurerId = ben1Id;
          }
          if (off.bendahara2Id && userMap.has(off.bendahara2Id)) {
            treasurer2Name = userMap.get(off.bendahara2Id)!.name;
            treasurer2Id = off.bendahara2Id;
          }
        }
      } catch (e) {
        console.warn('Gagal parse cls.officers:', e);
      }
    }

    // 2. Jika ada posisi yang belum terisi dari JSON, cari siswa dengan `classRole` eksplisit di kelas tersebut
    if (leaderName === '-' || viceLeaderName === '-' || secretaryName === '-' || treasurerName === '-') {
      const studentsWithRole = await prisma.user.findMany({
        where: {
          className: { in: variations },
          role: 'STUDENT',
          isActive: true,
          classRole: { not: null }
        },
        select: { id: true, name: true, classRole: true }
      });

      for (const s of studentsWithRole) {
        const r = (s.classRole || '').trim().toLowerCase();
        if ((r === 'ketua kelas' || r === 'ketua') && leaderName === '-') {
          leaderName = s.name;
          leaderId = s.id;
        } else if ((r.includes('wakil')) && viceLeaderName === '-') {
          viceLeaderName = s.name;
          viceLeaderId = s.id;
        } else if ((r.includes('sekretaris 1') || r === 'sekretaris') && secretaryName === '-') {
          secretaryName = s.name;
          secretaryId = s.id;
        } else if (r.includes('sekretaris 2') && !secretary2Name) {
          secretary2Name = s.name;
          secretary2Id = s.id;
        } else if ((r.includes('bendahara 1') || r === 'bendahara') && treasurerName === '-') {
          treasurerName = s.name;
          treasurerId = s.id;
        } else if (r.includes('bendahara 2') && !treasurer2Name) {
          treasurer2Name = s.name;
          treasurer2Id = s.id;
        }
      }
    }

    const info: ClassCommitteeInfo = {
      leaderName,
      leaderId,
      viceLeaderName,
      viceLeaderId,
      secretaryName,
      secretaryId,
      secretary2Name,
      secretary2Id,
      treasurerName,
      treasurerId,
      treasurer2Name,
      treasurer2Id
    };

    committeeCache[cacheKey] = { data: info, timestamp: Date.now() };
    return info;
  } catch (err) {
    console.error(`Error resolving real committee for class ${className}:`, err);
    return {
      leaderName: '-',
      viceLeaderName: '-',
      secretaryName: '-',
      treasurerName: '-'
    };
  }
}

/**
 * Mengecek apakah siswa tertentu adalah Pengurus Kelas (Ketua, Wakil, Sekretaris, atau Bendahara)
 */
export async function checkStudentCommitteeRole(
  studentId: string,
  studentName: string,
  className: string
): Promise<{ isCommittee: boolean; position: string | null; committee: ClassCommitteeInfo }> {
  const committee = await getClassCommittee(className);

  const cleanName = (studentName || '').toLowerCase().trim();
  const cleanId = (studentId || '').trim();

  // 1. Cek langsung dari database jika user memiliki field classRole
  if (cleanId) {
    try {
      const u = await prisma.user.findUnique({
        where: { id: cleanId },
        select: { classRole: true }
      });
      if (u?.classRole) {
        const cr = u.classRole.trim();
        const lowerCr = cr.toLowerCase();
        const validRoles = ['ketua kelas', 'ketua', 'wakil ketua kelas', 'wakil', 'sekretaris', 'sekretaris 1', 'sekretaris 2', 'bendahara', 'bendahara 1', 'bendahara 2'];
        if (validRoles.includes(lowerCr)) {
          return { isCommittee: true, position: cr, committee };
        }
      }
    } catch (_) {}
  }

  // 2. Cek kesesuaian dengan struktur committee terdaftar
  if ((committee.leaderId && committee.leaderId === cleanId) || (committee.leaderName && committee.leaderName !== '-' && cleanName === committee.leaderName.toLowerCase().trim())) {
    return { isCommittee: true, position: 'Ketua Kelas', committee };
  }
  if ((committee.viceLeaderId && committee.viceLeaderId === cleanId) || (committee.viceLeaderName && committee.viceLeaderName !== '-' && cleanName === committee.viceLeaderName.toLowerCase().trim())) {
    return { isCommittee: true, position: 'Wakil Ketua Kelas', committee };
  }
  if ((committee.secretaryId && committee.secretaryId === cleanId) || (committee.secretaryName && committee.secretaryName !== '-' && cleanName === committee.secretaryName.toLowerCase().trim())) {
    return { isCommittee: true, position: 'Sekretaris 1', committee };
  }
  if ((committee.secretary2Id && committee.secretary2Id === cleanId) || (committee.secretary2Name && committee.secretary2Name !== '-' && cleanName === committee.secretary2Name.toLowerCase().trim())) {
    return { isCommittee: true, position: 'Sekretaris 2', committee };
  }
  if ((committee.treasurerId && committee.treasurerId === cleanId) || (committee.treasurerName && committee.treasurerName !== '-' && cleanName === committee.treasurerName.toLowerCase().trim())) {
    return { isCommittee: true, position: 'Bendahara 1', committee };
  }
  if ((committee.treasurer2Id && committee.treasurer2Id === cleanId) || (committee.treasurer2Name && committee.treasurer2Name !== '-' && cleanName === committee.treasurer2Name.toLowerCase().trim())) {
    return { isCommittee: true, position: 'Bendahara 2', committee };
  }

  return { isCommittee: false, position: null, committee };
}
