//! Compare Windows process CPU accounting against short-lived worker thread CPU.
#[cfg(windows)]
fn main() {
    use std::ffi::c_void;
    use std::hint::black_box;
    use std::thread;
    use std::time::{Duration, Instant};

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn GetCurrentThread() -> *mut c_void;
        fn GetProcessTimes(
            handle: *mut c_void,
            created: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
        fn GetThreadTimes(
            handle: *mut c_void,
            created: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
        fn QueryProcessCycleTime(handle: *mut c_void, cycles: *mut u64) -> i32;
        fn QueryThreadCycleTime(handle: *mut c_void, cycles: *mut u64) -> i32;
    }
    fn ticks(time: &FileTime) -> u64 {
        (u64::from(time.high) << 32) | u64::from(time.low)
    }
    fn read(thread: bool) -> u64 {
        let (mut created, mut exit, mut kernel, mut user) = (
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
        );
        let result = unsafe {
            if thread {
                GetThreadTimes(
                    GetCurrentThread(),
                    &mut created,
                    &mut exit,
                    &mut kernel,
                    &mut user,
                )
            } else {
                GetProcessTimes(
                    GetCurrentProcess(),
                    &mut created,
                    &mut exit,
                    &mut kernel,
                    &mut user,
                )
            }
        };
        assert_ne!(result, 0, "Windows timing call failed");
        ticks(&kernel) + ticks(&user)
    }
    fn cycles(thread: bool) -> u64 {
        let mut value = 0;
        let result = unsafe {
            if thread {
                QueryThreadCycleTime(GetCurrentThread(), &mut value)
            } else {
                QueryProcessCycleTime(GetCurrentProcess(), &mut value)
            }
        };
        assert_ne!(result, 0, "Windows cycle counter failed");
        value
    }
    for sample in 0..5 {
        let process_before = read(false);
        let started = Instant::now();
        let workers: Vec<_> = (0..2)
            .map(|_| {
                thread::spawn(|| {
                    let before = read(true);
                    let start = Instant::now();
                    let mut value = 1u64;
                    while start.elapsed() < Duration::from_millis(400) {
                        for _ in 0..4096 {
                            value =
                                black_box(value.wrapping_mul(6364136223846793005).wrapping_add(1));
                        }
                    }
                    black_box(value);
                    read(true) - before
                })
            })
            .collect();
        let thread_ticks: u64 = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .sum();
        let process_ticks = read(false) - process_before;
        println!(
            "sample={sample} wall_ms={:.2} process_cpu_ms={:.2} workers_cpu_ms={:.2}",
            started.elapsed().as_secs_f64() * 1000.0,
            process_ticks as f64 / 10_000.0,
            thread_ticks as f64 / 10_000.0
        );
    }
    for sample in 0..3 {
        let process_before = read(false);
        let cycles_before = cycles(false);
        let started = Instant::now();
        let mut worker_ticks = 0;
        let mut worker_cycles = 0;
        for _ in 0..100 {
            let workers: Vec<_> = (0..2)
                .map(|_| {
                    thread::spawn(|| {
                        let before = read(true);
                        let cycles_before = cycles(true);
                        let start = Instant::now();
                        let mut value = 1u64;
                        while start.elapsed() < Duration::from_millis(2) {
                            for _ in 0..4096 {
                                value = black_box(
                                    value.wrapping_mul(6364136223846793005).wrapping_add(1),
                                );
                            }
                        }
                        black_box(value);
                        (read(true) - before, cycles(true) - cycles_before)
                    })
                })
                .collect();
            for worker in workers {
                let (ticks, cycles) = worker.join().unwrap();
                worker_ticks += ticks;
                worker_cycles += cycles;
            }
        }
        let process_ticks = read(false) - process_before;
        let process_cycles = cycles(false) - cycles_before;
        println!("burst={sample} threads=200 wall_ms={:.2} process_cpu_ms={:.2} workers_cpu_ms={:.2} process_cycles={process_cycles} workers_cycles={worker_cycles}", started.elapsed().as_secs_f64() * 1000.0, process_ticks as f64 / 10_000.0, worker_ticks as f64 / 10_000.0);
    }
    for sample in 0..3 {
        use std::sync::{mpsc, Arc, Barrier};
        let ready = Arc::new(Barrier::new(3));
        let start = Arc::new(Barrier::new(3));
        let done = Arc::new(Barrier::new(3));
        let release = Arc::new(Barrier::new(3));
        let (sender, receiver) = mpsc::channel();
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let (ready, start, done, release, sender) = (
                    ready.clone(),
                    start.clone(),
                    done.clone(),
                    release.clone(),
                    sender.clone(),
                );
                thread::spawn(move || {
                    let before = read(true);
                    let cycles_before = cycles(true);
                    ready.wait();
                    for _ in 0..100 {
                        start.wait();
                        let began = Instant::now();
                        let mut value = 1u64;
                        while began.elapsed() < Duration::from_millis(2) {
                            for _ in 0..4096 {
                                value = black_box(
                                    value.wrapping_mul(6364136223846793005).wrapping_add(1),
                                );
                            }
                        }
                        black_box(value);
                        done.wait();
                    }
                    sender
                        .send((read(true) - before, cycles(true) - cycles_before))
                        .unwrap();
                    release.wait();
                })
            })
            .collect();
        ready.wait();
        let process_before = read(false);
        let cycles_before = cycles(false);
        let began = Instant::now();
        for _ in 0..100 {
            start.wait();
            done.wait();
        }
        let stats: Vec<_> = (0..2).map(|_| receiver.recv().unwrap()).collect();
        let process_ticks = read(false) - process_before;
        let process_cycles = cycles(false) - cycles_before;
        let worker_ticks: u64 = stats.iter().map(|item| item.0).sum();
        let worker_cycles: u64 = stats.iter().map(|item| item.1).sum();
        println!("persistent={sample} threads=2 tasks=200 wall_ms={:.2} process_cpu_ms={:.2} workers_cpu_ms={:.2} process_cycles={process_cycles} workers_cycles={worker_cycles}", began.elapsed().as_secs_f64() * 1000.0, process_ticks as f64 / 10_000.0, worker_ticks as f64 / 10_000.0);
        release.wait();
        for worker in workers {
            worker.join().unwrap();
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("This probe requires Windows");
}
