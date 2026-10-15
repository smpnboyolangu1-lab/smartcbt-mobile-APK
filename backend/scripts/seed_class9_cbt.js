const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- SEEDING 3 PAKET SOAL KELAS 9 SMP DENGAN LISTENING ---');

    const classesList = ['IX-A', 'IX-B', 'IX-C', 'IX-D', 'IX-E', 'IX-F', 'IX-G', 'IX-H', 'IX-I', 'IX-J', 'IX-K'];
    const assignedClassesStr = classesList.join(',');
    const todayStr = '2026-10-13';

    // 1. Get or verify subjects
    let subjBindo = await prisma.subject.findFirst({ where: { name: { contains: 'Bahasa Indonesia' } } });
    if (!subjBindo) subjBindo = await prisma.subject.create({ data: { name: 'Bahasa Indonesia' } });

    let subjBing = await prisma.subject.findFirst({ where: { name: { contains: 'Bahasa Inggris' } } });
    if (!subjBing) subjBing = await prisma.subject.create({ data: { name: 'Bahasa Inggris & Sains' } });

    let subjMat = await prisma.subject.findFirst({ where: { name: { contains: 'Matematika' } } });
    if (!subjMat) subjMat = await prisma.subject.create({ data: { name: 'Matematika Terpadu' } });

    // Hapus ujian paket IX lama jika ada dengan token sama
    await prisma.question.deleteMany({
        where: { exam: { token: { in: ['IXBINDO', 'IXENG99', 'IXMATH9'] } } }
    });
    await prisma.examClassToken.deleteMany({
        where: { exam: { token: { in: ['IXBINDO', 'IXENG99', 'IXMATH9'] } } }
    });
    await prisma.exam.deleteMany({
        where: { token: { in: ['IXBINDO', 'IXENG99', 'IXMATH9'] } }
    });

    // -------------------------------------------------------------
    // PAKET 1: BAHASA INDONESIA KELAS IX
    // -------------------------------------------------------------
    const examBindo = await prisma.exam.create({
        data: {
            title: 'Asesmen Terpadu Bahasa Indonesia Kelas IX - Literasi & Pemahaman Teks',
            subjectId: subjBindo.id,
            token: 'IXBINDO',
            isTokenActive: true,
            durationMinutes: 60,
            minDurationMinutes: 20,
            assignedClasses: assignedClassesStr,
            sessionName: 'Sesi 1 (Pagi)',
            executionDate: todayStr,
            startTimeStr: '07:30',
            endTimeStr: '12:00',
            randomizeQuestions: false,
            randomizeOptions: true,
            showScoreToStudent: true,
            maxStrikes: 3,
            examType: 'SAS',
            roomName: 'Ruang Kelas IX',
            proctorName: 'Pengawas Ruang Terpadu',
            passingGrade: 75,
            level: 'IX',
            packageCode: 'AS-BIN-IX-01',
            status: 'DIRILIS',
            isOptionDOnly: true,
            autoActiveOnSchedule: true
        }
    });

    const bindoQuestions = [
        {
            content: 'Bacalah teks berikut!\n"Hutan mangrove di pesisir pantai berperan penting sebagai pemecah gelombang alami dan pencegah abrasi. Selain itu, kawasan mangrove menjadi habitat bagi beragam biota laut seperti kepiting bakau, udang, dan ikan kecil."\nIde pokok paragraf tersebut adalah...',
            options: JSON.stringify(['Fungsi dan peran strategis hutan mangrove', 'Pencegahan abrasi pantai oleh nelayan', 'Perkembangbiakan kepiting bakau di rawa', 'Gelombang laut pesisir selatan']),
            correctOption: 'A',
            orderNum: 1,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.1',
            explanation: 'Paragraf membahas peranan penting mangrove sebagai pemecah gelombang dan habitat biota laut.'
        },
        {
            content: 'Kalimat berikut yang menggunakan konjungsi kausalitas yang tepat adalah...',
            options: JSON.stringify(['Siswa rajin belajar sehingga memperoleh nilai yang sangat memuaskan.', 'Meskipun hujan turun lebat, ia tetap berjalan kaki ke sekolah.', 'Setelah bel masuk berbunyi, siswa berbaris rapi di depan kelas.', 'Ia pandai melukis tetapi tidak suka menyanyi.']),
            correctOption: 'A',
            orderNum: 2,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.2',
            explanation: 'Kata "sehingga" menyatakan hubungan akibat (kausalitas).'
        },
        {
            content: 'Cermati kutipan cerpen berikut:\n"Matahari mulai tenggelam di balik bukit. Suara jangkrik bersahut-sahutan mengiringi langkah Pak Karta yang letih memikul cangkulnya pulang dari sawah."\nLatar waktu dan suasana pada kutipan tersebut adalah...',
            options: JSON.stringify(['Senja hari, tenang dan damai', 'Pagi hari, bersemangat', 'Tengah malam, mencekam', 'Siang hari, gersang dan terik']),
            correctOption: 'A',
            orderNum: 3,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.5',
            explanation: 'Matahari tenggelam menandakan waktu senja dengan suasana pedesaan yang tenang.'
        },
        {
            content: 'Teks laporan hasil observasi harus disajikan berdasarkan...',
            options: JSON.stringify(['Fakta dan data yang diamati secara objektif', 'Pendapat pribadi penulis yang subjektif', 'Imajinasi dan cerita fiksi pengarang', 'Gosip atau kabar burung di masyarakat']),
            correctOption: 'A',
            orderNum: 4,
            cognitiveLevel: 'C1',
            kdTag: 'KD 3.1',
            explanation: 'Teks LHO disusun berdasarkan fakta objektif di lapangan.'
        },
        {
            content: 'Kalimat persuasif yang sering digunakan dalam pidato bertema lingkungan adalah...',
            options: JSON.stringify(['Marilah kita bersama-sama menjaga kebersihan lingkungan dengan tidak membuang sampah sembarangan!', 'Kebersihan adalah sebagian dari iman yang diajarkan.', 'Sampah plastik membutuhkan ratusan tahun untuk terurai.', 'Banjir melanda kawasan permukiman warga akibat saluran tersumbat.']),
            correctOption: 'A',
            orderNum: 5,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.4',
            explanation: 'Kalimat persuasif ditandai dengan ajakan "Marilah kita...".'
        },
        {
            content: 'Manakah di bawah ini yang merupakan ciri bahasa teks tanggapan kritis?',
            options: JSON.stringify(['Menggunakan bahasa yang santun, logis, dan objektif disertai argumen kuat', 'Menggunakan kata-kata kasar dan menghakimi pembuat karya', 'Menyajikan cerita humor tanpa disertai fakta', 'Menggunakan kalimat tanya yang tidak membutuhkan jawaban']),
            correctOption: 'A',
            orderNum: 6,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.7',
            explanation: 'Teks tanggapan kritis wajib santun, logis, dan objektif.'
        },
        {
            content: 'Kata arkais yang bermakna "istana" dalam cerita hikayat adalah...',
            options: JSON.stringify(['Mahligai', 'Benteng', 'Khatib', 'Pustaka']),
            correctOption: 'A',
            orderNum: 7,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.8',
            explanation: 'Mahligai berarti istana atau bangunan megah tempat raja bersemayam.'
        },
        {
            content: 'Penggunaan tanda baca koma (,) yang tepat terdapat pada kalimat...',
            options: JSON.stringify(['Ibu membeli apel, jeruk, dan mangga di pasar Boyolangu.', 'Ibu membeli, apel, jeruk dan mangga.', 'Ibu membeli apel jeruk, dan mangga.', 'Ibu, membeli apel jeruk dan mangga.']),
            correctOption: 'A',
            orderNum: 8,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.6',
            explanation: 'Tanda koma digunakan di antara unsur-unsur dalam perincian lebih dari dua.'
        },
        {
            content: 'Makna tersirat dari peribahasa "Air beriak tanda tak dalam" adalah...',
            options: JSON.stringify(['Orang yang banyak bicara biasanya berilmu sedikit', 'Sungai yang jernih memiliki banyak ikan', 'Orang pendiam selalu menyimpan rahasia besar', 'Jangan bermain di air yang deras']),
            correctOption: 'A',
            orderNum: 9,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.9',
            explanation: 'Peribahasa ini menyindir orang yang gemar membual tetapi minim pengetahuan.'
        },
        {
            content: 'Unsur intrinsik cerpen yang berkaitan dengan pesan moral yang ingin disampaikan penulis kepada pembaca disebut...',
            options: JSON.stringify(['Amanat', 'Tema', 'Alur', 'Penokohan']),
            correctOption: 'A',
            orderNum: 10,
            cognitiveLevel: 'C1',
            kdTag: 'KD 3.5',
            explanation: 'Amanat adalah pesan moral pengarang.'
        },
        {
            content: 'Penulisan judul karangan berikut yang sesuai dengan EYD/PUEBI adalah...',
            options: JSON.stringify(['Pemanfaatan Energi Surya di Daerah Tropis', 'Pemanfaatan energi surya di Daerah tropis', 'Pemanfaatan Energi Surya Di Daerah Tropis', 'pemanfaatan Energi Surya Di daerah Tropis']),
            correctOption: 'A',
            orderNum: 11,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.2',
            explanation: 'Huruf pertama setiap kata judul kapital, kecuali kata tugas seperti "di".'
        },
        {
            content: 'Struktur teks pidato persuasif yang benar secara berurutan adalah...',
            options: JSON.stringify(['Salam pembuka, pendahuluan, isi pidato, penutup, salam penutup', 'Isi pidato, pendahuluan, kesimpulan, salam penutup', 'Salam pembuka, kesimpulan, isi pidato, salam penutup', 'Pendahuluan, salam penutup, isi pidato, penutup']),
            correctOption: 'A',
            orderNum: 12,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.4',
            explanation: 'Struktur pidato: Pembuka, Pendahuluan, Isi, Penutup, Salam Penutup.'
        },
        {
            content: 'Kalimat yang memuat majas personifikasi adalah...',
            options: JSON.stringify(['Nyiur melambai-lambai di tepi pantai menyapa sang pengelana.', 'Hatinya seputih salju di musim dingin.', 'Suaranya menggelegar membelah angkasa raya.', 'Ia adalah bunga desa yang memikat hati semua pemuda.']),
            correctOption: 'A',
            orderNum: 13,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.5',
            explanation: 'Personifikasi mengumpamakan benda mati seolah bersikap seperti manusia (nyiur melambai menyapa).'
        },
        {
            content: 'Kata tidak baku di bawah ini yang harus diubah menjadi bentuk baku adalah...',
            options: JSON.stringify(['Aktifitas -> Aktivitas', 'Kualitas -> Kwalitas', 'Analisis -> Analisa', 'Metode -> Metoda']),
            correctOption: 'A',
            orderNum: 14,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.2',
            explanation: 'Bentuk baku dalam KBBI adalah aktivitas (menggunakan v).'
        },
        {
            content: 'Tujuan utama penulisan teks diskusi adalah...',
            options: JSON.stringify(['Menyajikan pendapat dari dua sudut pandang berbeda (pro dan kontra) secara berimbang', 'Memaksa pembaca menyetujui salah satu opini pengarang', 'Menceritakan kembali kisah hidup tokoh terkenal', 'Menghibur pembaca dengan dongeng jenaka']),
            correctOption: 'A',
            orderNum: 15,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.10',
            explanation: 'Teks diskusi menyajikan argumen dari dua sisi yang berbeda untuk mencari mufakat/pemahaman.'
        }
    ];

    for (const q of bindoQuestions) {
        await prisma.question.create({
            data: {
                examId: examBindo.id,
                type: 'MULTIPLE_CHOICE',
                content: q.content,
                mediaType: 'NONE',
                options: q.options,
                correctOption: q.correctOption,
                orderNum: q.orderNum,
                cognitiveLevel: q.cognitiveLevel,
                kdTag: q.kdTag,
                explanation: q.explanation
            }
        });
    }

    // -------------------------------------------------------------
    // PAKET 2: BAHASA INGGRIS KELAS IX (DENGAN 5 SOAL LISTENING)
    // -------------------------------------------------------------
    const examBing = await prisma.exam.create({
        data: {
            title: 'Asesmen Terpadu Bahasa Inggris Kelas IX - Listening & Reading Practice',
            subjectId: subjBing.id,
            token: 'IXENG99',
            isTokenActive: true,
            durationMinutes: 60,
            minDurationMinutes: 20,
            assignedClasses: assignedClassesStr,
            sessionName: 'Sesi 1 (Pagi)',
            executionDate: todayStr,
            startTimeStr: '07:30',
            endTimeStr: '12:00',
            randomizeQuestions: false,
            randomizeOptions: true,
            showScoreToStudent: true,
            maxStrikes: 3,
            examType: 'SAS',
            roomName: 'Ruang Kelas IX',
            proctorName: 'Pengawas Ruang Terpadu',
            passingGrade: 75,
            level: 'IX',
            packageCode: 'AS-ENG-IX-02',
            status: 'DIRILIS',
            isOptionDOnly: true,
            autoActiveOnSchedule: true
        }
    });

    const listeningAudioUrl = '/uploads/cbt/audio/english_listening_practice.wav';

    const bingQuestions = [
        // 5 Soal Listening Comprehension
        {
            content: '[LISTENING SECTION]\nListen to the dialogue carefully by pressing the Audio Player above.\nQuestion 1: What did David complete last night according to the dialogue?',
            options: JSON.stringify(['The presentation on solar energy', 'A biology homework about mangrove', 'A math assignment on quadratic equations', 'An English poem recitation']),
            correctOption: 'A',
            orderNum: 1,
            audioUrl: listeningAudioUrl,
            mediaType: 'AUDIO',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.1 Listening',
            explanation: 'In the audio, David says: "I completed the presentation on solar energy last night."'
        },
        {
            content: '[LISTENING SECTION]\nListen to the audio recording.\nQuestion 2: When does Mrs. Green ask David to submit the project?',
            options: JSON.stringify(['Before noon today', 'Tomorrow morning', 'Next Monday', 'At the end of the semester']),
            correctOption: 'A',
            orderNum: 2,
            audioUrl: listeningAudioUrl,
            mediaType: 'AUDIO',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.1 Listening',
            explanation: 'Mrs. Green says: "Please submit it before noon."'
        },
        {
            content: '[LISTENING SECTION]\nListen to the weather forecast part in the audio.\nQuestion 3: How is the weather described in Boyolangu today?',
            options: JSON.stringify(['Warm and sunny with a gentle breeze', 'Rainy and stormy with thunder', 'Cold and foggy with heavy clouds', 'Snowing and freezing']),
            correctOption: 'A',
            orderNum: 3,
            audioUrl: listeningAudioUrl,
            mediaType: 'AUDIO',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.1 Listening',
            explanation: 'The narrator states: "The weather is warm and sunny with a gentle breeze."'
        },
        {
            content: '[LISTENING SECTION]\nListen to the speakers in the recording.\nQuestion 4: What is the relationship between the two speakers in the first dialogue?',
            options: JSON.stringify(['Teacher and student', 'Doctor and patient', 'Shopkeeper and customer', 'Brother and sister']),
            correctOption: 'A',
            orderNum: 4,
            audioUrl: listeningAudioUrl,
            mediaType: 'AUDIO',
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.2 Listening',
            explanation: 'David calls Mrs. Green, and she gives him academic instructions regarding the science project.'
        },
        {
            content: '[LISTENING SECTION]\nBased on the listening audio introduction:\nQuestion 5: What grade level is this listening comprehension test intended for?',
            options: JSON.stringify(['Grade 9 (Kelas IX)', 'Grade 7 (Kelas VII)', 'Grade 8 (Kelas VIII)', 'Grade 12 (SMA)']),
            correctOption: 'A',
            orderNum: 5,
            audioUrl: listeningAudioUrl,
            mediaType: 'AUDIO',
            cognitiveLevel: 'C1',
            kdTag: 'KD 3.1 Listening',
            explanation: 'The narrator clearly opens: "This is the English Listening Comprehension test for Grade 9."'
        },
        // 10 Soal Reading, Grammar & Expression
        {
            content: 'Read the greeting card below:\n"Congratulations on winning the National Science Olympiad 2026, Sarah! Your hard work and dedication have paid off. We are so proud of you!"\nWhat is the purpose of the text?',
            options: JSON.stringify(['To congratulate Sarah on her great achievement', 'To invite Sarah to a science competition', 'To announce the winners of the Olympiad', 'To ask Sarah for science tips']),
            correctOption: 'A',
            orderNum: 6,
            mediaType: 'NONE',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.5 Reading',
            explanation: 'The text is a greeting card congratulating Sarah.'
        },
        {
            content: 'Choose the correct expression of agreement:\nRian: "I think watching documentary movies is more educational than action movies."\nDoni: "__________! I learn so many scientific facts from documentaries."',
            options: JSON.stringify(['I totally agree with you', 'I completely disagree', 'I don\'t think that\'s true', 'I am against your idea']),
            correctOption: 'A',
            orderNum: 7,
            mediaType: 'NONE',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.2 Expression',
            explanation: 'Doni supports Rian\'s statement, showing total agreement.'
        },
        {
            content: 'Change the active sentence into PASSIVE VOICE:\n"The students clean the laboratory every Friday afternoon."',
            options: JSON.stringify(['The laboratory is cleaned by the students every Friday afternoon.', 'The laboratory was cleaned by the students every Friday afternoon.', 'The laboratory is being cleaned by the students.', 'The laboratory has been cleaned by the students.']),
            correctOption: 'A',
            orderNum: 8,
            mediaType: 'NONE',
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.8 Grammar',
            explanation: 'Simple present tense passive formula: Object + is/am/are + V3 + by Subject.'
        },
        {
            content: 'Complete the sentence with the correct conjunction:\n"We should wear face masks and wash our hands regularly __________ we can avoid getting sick."',
            options: JSON.stringify(['in order that / so that', 'although', 'because of', 'despite']),
            correctOption: 'A',
            orderNum: 9,
            mediaType: 'NONE',
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.3 Conjunction',
            explanation: '"So that / in order that" expresses purpose or goal.'
        },
        {
            content: 'Read the procedure text step:\n"First, plug the cable into the electrical outlet. Next, press the power button and wait for the indicator light to turn green."\nWhat does the word "outlet" refer to?',
            options: JSON.stringify(['A socket where electric devices connect to electricity', 'The main water pipe in the building', 'A store selling discount clothes', 'The display monitor of a computer']),
            correctOption: 'A',
            orderNum: 10,
            mediaType: 'NONE',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.4 Procedure',
            explanation: 'An electrical outlet is an electric socket.'
        },
        {
            content: 'Which sentence uses the PRESENT PERFECT TENSE correctly?',
            options: JSON.stringify(['She has lived in Tulungagung for five years.', 'She has live in Tulungagung for five years.', 'She have living in Tulungagung yesterday.', 'She lived in Tulungagung since tomorrow.']),
            correctOption: 'A',
            orderNum: 11,
            mediaType: 'NONE',
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.6 Grammar',
            explanation: 'Subject "She" uses "has" followed by Past Participle (V3) "lived".'
        },
        {
            content: 'In narrative stories, the moral lesson learned from the fable "The Ant and the Grasshopper" is...',
            options: JSON.stringify(['It is wise to work hard and prepare for future hardships', 'Playing music all day will keep you warm in winter', 'Never trust your neighbors in times of need', 'Always sleep during summer to save energy']),
            correctOption: 'A',
            orderNum: 12,
            mediaType: 'NONE',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.7 Narrative',
            explanation: 'The fable teaches diligence and foresight.'
        },
        {
            content: 'Identify the antonym of the underlined word:\n"The experiment gave an [accurate] calculation of velocity."',
            options: JSON.stringify(['Incorrect / Flawed', 'Precise', 'Correct', 'Exact']),
            correctOption: 'A',
            orderNum: 13,
            mediaType: 'NONE',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.9 Vocabulary',
            explanation: 'The antonym of accurate (tepat) is incorrect or flawed (salah).'
        },
        {
            content: 'Fill in the blank with the appropriate modal verb:\n"You look very pale and dizzy. I think you __________ see the school doctor immediately."',
            options: JSON.stringify(['ought to / should', 'may not', 'might rarely', 'can never']),
            correctOption: 'A',
            orderNum: 14,
            mediaType: 'NONE',
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.3 Expression',
            explanation: '"Should / ought to" is used to give strong advice or recommendation.'
        },
        {
            content: 'What is the main characteristic of a report text compared to a descriptive text?',
            options: JSON.stringify(['Report text describes things in general categories, while descriptive text focuses on a specific entity', 'Report text only uses past tense while descriptive uses future tense', 'Report text is purely fictional while descriptive text is poetry', 'Report text never uses facts and figures']),
            correctOption: 'A',
            orderNum: 15,
            mediaType: 'NONE',
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.10 Genre',
            explanation: 'Report text deals with general classification, descriptive deals with specific subjects.'
        }
    ];

    for (const q of bingQuestions) {
        await prisma.question.create({
            data: {
                examId: examBing.id,
                type: 'MULTIPLE_CHOICE',
                content: q.content,
                mediaType: q.mediaType || 'NONE',
                audioUrl: q.audioUrl || null,
                options: q.options,
                correctOption: q.correctOption,
                orderNum: q.orderNum,
                cognitiveLevel: q.cognitiveLevel,
                kdTag: q.kdTag,
                explanation: q.explanation
            }
        });
    }

    // -------------------------------------------------------------
    // PAKET 3: MATEMATIKA & SAINS KELAS IX (NUMERASI & SAINS DATA)
    // -------------------------------------------------------------
    const examMat = await prisma.exam.create({
        data: {
            title: 'Asesmen Terpadu Matematika & Sains Kelas IX - Numerasi Berbasis Masalah',
            subjectId: subjMat.id,
            token: 'IXMATH9',
            isTokenActive: true,
            durationMinutes: 60,
            minDurationMinutes: 20,
            assignedClasses: assignedClassesStr,
            sessionName: 'Sesi 1 (Pagi)',
            executionDate: todayStr,
            startTimeStr: '07:30',
            endTimeStr: '12:00',
            randomizeQuestions: false,
            randomizeOptions: true,
            showScoreToStudent: true,
            maxStrikes: 3,
            examType: 'SAS',
            roomName: 'Ruang Kelas IX',
            proctorName: 'Pengawas Ruang Terpadu',
            passingGrade: 75,
            level: 'IX',
            packageCode: 'AS-MAT-IX-03',
            status: 'DIRILIS',
            isOptionDOnly: true,
            autoActiveOnSchedule: true
        }
    });

    const matQuestions = [
        {
            content: 'Akar-akar dari persamaan kuadrat x² - 5x + 6 = 0 adalah...',
            options: JSON.stringify(['x = 2 atau x = 3', 'x = -2 atau x = -3', 'x = 1 atau x = 6', 'x = -1 atau x = -6']),
            correctOption: 'A',
            orderNum: 1,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.2 Persamaan Kuadrat',
            explanation: '(x - 2)(x - 3) = 0 => x = 2 atau x = 3.'
        },
        {
            content: 'Bentuk sederhana dari perpangkatan (2³ × 2⁴) / 2² adalah...',
            options: JSON.stringify(['2⁵ = 32', '2⁶ = 64', '2⁴ = 16', '2⁷ = 128']),
            correctOption: 'A',
            orderNum: 2,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.1 Bilangan Berpangkat',
            explanation: '2^(3+4-2) = 2^5 = 32.'
        },
        {
            content: 'Titik A(3, -4) dicerminkan terhadap sumbu X. Koordinat bayangan titik A adalah...',
            options: JSON.stringify(['A\'(3, 4)', 'A\'(-3, -4)', 'A\'(-3, 4)', 'A\'(-4, 3)']),
            correctOption: 'A',
            orderNum: 3,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.3 Transformasi Geometri',
            explanation: 'Pencerminan terhadap sumbu X: (x, y) -> (x, -y). Maka (3, -(-4)) = (3, 4).'
        },
        {
            content: 'Sebuah tabung memiliki jari-jari alas 7 cm dan tinggi 10 cm. Volume tabung tersebut adalah... (gunakan π = 22/7)',
            options: JSON.stringify(['1.540 cm³', '1.450 cm³', '770 cm³', '2.200 cm³']),
            correctOption: 'A',
            orderNum: 4,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.4 Bangun Ruang Sisi Lengkung',
            explanation: 'V = π × r² × t = (22/7) × 7 × 7 × 10 = 22 × 70 = 1.540 cm³.'
        },
        {
            content: 'Dua buah muatan listrik masing-masing q1 = +2 μC dan q2 = +4 μC terpisah sejauh r. Menurut Hukum Coulomb, jika jarak kedua muatan diperbesar menjadi 2 kali semula, maka gaya tolak-menolak antara keduanya menjadi...',
            options: JSON.stringify(['1/4 kali semula', '1/2 kali semula', '2 kali semula', '4 kali semula']),
            correctOption: 'A',
            orderNum: 5,
            cognitiveLevel: 'C4',
            kdTag: 'KD 3.5 Listrik Statis (IPA)',
            explanation: 'F berbanding terbalik dengan kuadrat jarak (1/r²). Jika r menjadi 2r, maka F menjadi 1/(2²) = 1/4 kali semula.'
        },
        {
            content: 'Sebuah setrika listrik memiliki hambatan 100 Ω dihubungkan ke sumber tegangan 220 V. Kuat arus listrik yang mengalir melalui setrika tersebut adalah...',
            options: JSON.stringify(['2,2 Ampere', '0,45 Ampere', '22 Ampere', '220 Ampere']),
            correctOption: 'A',
            orderNum: 6,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.6 Listrik Dinamis (IPA)',
            explanation: 'Hukum Ohm: I = V / R = 220 / 100 = 2,2 A.'
        },
        {
            content: 'Mikroorganisme yang digunakan dalam proses pembuatan tempe melalui fermentasi kedelai adalah...',
            options: JSON.stringify(['Rhizopus oryzae', 'Saccharomyces cerevisiae', 'Lactobacillus bulgaricus', 'Acetobacter xylinum']),
            correctOption: 'A',
            orderNum: 7,
            cognitiveLevel: 'C1',
            kdTag: 'KD 3.7 Bioteknologi (IPA)',
            explanation: 'Rhizopus oryzae adalah jamur yang digunakan dalam fermentasi tempe.'
        },
        {
            content: 'Persamaan sumbu simetri dari fungsi kuadrat f(x) = x² - 6x + 8 adalah...',
            options: JSON.stringify(['x = 3', 'x = -3', 'x = 6', 'x = 4']),
            correctOption: 'A',
            orderNum: 8,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.2 Fungsi Kuadrat',
            explanation: 'Sumbu simetri: x = -b / (2a) = -(-6) / (2 × 1) = 6 / 2 = 3.'
        },
        {
            content: 'Nilai dari √75 - √12 + √27 adalah...',
            options: JSON.stringify(['6√3', '4√3', '5√3', '8√3']),
            correctOption: 'A',
            orderNum: 9,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.1 Bentuk Akar',
            explanation: '√75 = 5√3, √12 = 2√3, √27 = 3√3. Maka 5√3 - 2√3 + 3√3 = 6√3.'
        },
        {
            content: 'Jika titik B(2, 5) ditranslasikan oleh T = (-3, 4), maka koordinat bayangan titik B adalah...',
            options: JSON.stringify(['B\'(-1, 9)', 'B\'(5, 1)', 'B\'(-1, 1)', 'B\'(5, 9)']),
            correctOption: 'A',
            orderNum: 10,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.3 Translasi',
            explanation: 'B\' = (2 + (-3), 5 + 4) = (-1, 9).'
        },
        {
            content: 'Organ reproduksi pria yang berfungsi sebagai tempat pematangan sperma adalah...',
            options: JSON.stringify(['Epididimis', 'Testis', 'Vas deferens', 'Uretra']),
            correctOption: 'A',
            orderNum: 11,
            cognitiveLevel: 'C1',
            kdTag: 'KD 3.8 Sistem Reproduksi (IPA)',
            explanation: 'Epididimis berfungsi sebagai tempat pematangan dan penyimpanan sementara sperma.'
        },
        {
            content: 'Persilangan monohibrid antara kacang ercis berbiji bulat (BB) dengan berbiji keriput (bb) menghasilkan keturunan F1 semuanya berbiji bulat (Bb). Jika F1 disilangkan sesamanya, perbandingan fenotipe pada keturunan F2 adalah...',
            options: JSON.stringify(['3 Bulat : 1 Keriput', '1 Bulat : 2 Sedang : 1 Keriput', '9 : 3 : 3 : 1', '1 Bulat : 1 Keriput']),
            correctOption: 'A',
            orderNum: 12,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.9 Pewarisan Sifat (IPA)',
            explanation: 'Persilangan monohibrid dominan penuh menghasilkan fenotipe F2 dengan rasio 3 : 1.'
        },
        {
            content: 'Sebuah transformator step-up memiliki jumlah lilitan primer 100 dan lilitan sekunder 500. Jika tegangan primer adalah 220 V, maka tegangan sekunder yang dihasilkan adalah...',
            options: JSON.stringify(['1.100 V', '44 V', '2.200 V', '550 V']),
            correctOption: 'A',
            orderNum: 13,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.6 Kemagnetan (IPA)',
            explanation: 'Vs / Vp = Ns / Np => Vs = (500 / 100) × 220 = 5 × 220 = 1.100 V.'
        },
        {
            content: 'Nilai diskriminan (D) dari persamaan kuadrat 2x² - 3x - 5 = 0 adalah...',
            options: JSON.stringify(['49 (D > 0, memiliki dua akar real berbeda)', '31', '25', '-31']),
            correctOption: 'A',
            orderNum: 14,
            cognitiveLevel: 'C3',
            kdTag: 'KD 3.2 Persamaan Kuadrat',
            explanation: 'D = b² - 4ac = (-3)² - 4(2)(-5) = 9 + 40 = 49.'
        },
        {
            content: 'Benda bermuatan positif didekatkan pada elektroskop netral. Hal yang akan terjadi pada daun elektroskop adalah...',
            options: JSON.stringify(['Daun elektroskop membuka karena kedua daun bermuatan sejenis (positif)', 'Daun elektroskop tetap menutup rapat', 'Daun elektroskop membuka sesaat lalu terlepas', 'Kepala elektroskop bermuatan positif dan daun bermuatan negatif']),
            correctOption: 'A',
            orderNum: 15,
            cognitiveLevel: 'C2',
            kdTag: 'KD 3.5 Listrik Statis',
            explanation: 'Induksi muatan membuat kedua daun elektroskop bermuatan sama sehingga saling tolak menolak dan membuka.'
        }
    ];

    for (const q of matQuestions) {
        await prisma.question.create({
            data: {
                examId: examMat.id,
                type: 'MULTIPLE_CHOICE',
                content: q.content,
                mediaType: 'NONE',
                options: q.options,
                correctOption: q.correctOption,
                orderNum: q.orderNum,
                cognitiveLevel: q.cognitiveLevel,
                kdTag: q.kdTag,
                explanation: q.explanation
            }
        });
    }

    // -------------------------------------------------------------
    // GENERATE TOKEN PER KELAS DI TABEL ExamClassToken UNTUK KETIGA UJIAN
    // -------------------------------------------------------------
    const exams = [examBindo, examBing, examMat];
    for (const ex of exams) {
        for (const cls of classesList) {
            const clean = cls.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); // IXA, IXB...
            const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
            const classToken = `${clean}${rnd}`;
            await prisma.examClassToken.upsert({
                where: { examId_className: { examId: ex.id, className: cls } },
                update: { token: classToken, isActive: true },
                create: { examId: ex.id, className: cls, token: classToken, isActive: true }
            });
        }
    }

    console.log('✅ SUKSES SEEDING 3 PAKET SOAL KELAS 9:');
    console.log('1. Bahasa Indonesia: ', examBindo.id, examBindo.token);
    console.log('2. Bahasa Inggris (Listening): ', examBing.id, examBing.token);
    console.log('3. Matematika & Sains: ', examMat.id, examMat.token);
    console.log('Seluruh kelas IX-A s/d IX-K berhasil di-plot token ruangnya.');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
