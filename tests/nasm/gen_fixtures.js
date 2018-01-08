#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const DEBUG = process.env.DEBUG || false;
// Maximum number of gdb processes to spawn in parallel
const MAX_PARALLEL_PROCS = +process.env.MAX_PARALLEL_PROCS || 32;

// Usage: console.log(CYAN_FMT, "This shows up in cyan!")
const CYAN_FMT = "\x1b[36m%s\x1b[0m";
const YELLOW_FMT = "\x1b[33m%s\x1b[0m";

const TEST_DIR = __dirname + "/";
const BUILD_DIR = TEST_DIR + "build/";

const GDB_DEFAULT_ARGS = [
    "-batch",
    `--command=${TEST_DIR}gdb-extract-def`
];

/* Split up an array into semi-evenly sized chunks */
function chunk(source, num_chunks)
{
    const arr = source.slice();
    const ret = [];

    let rem_chunks = num_chunks;
    while(rem_chunks > 0)
    {
        // We guarantee that the entire array is processed because when rem_chunk=1 -> len/1 = len
        ret.push(arr.splice(0, Math.floor(arr.length / rem_chunks)));
        rem_chunks--;
    }
    return ret;
}
console.assert(
    JSON.stringify(chunk("0 0 1 1 2 2 2 3 3 3".split(" "), 4)) ===
        JSON.stringify([["0", "0"],
                        ["1", "1"],
                        ["2", "2", "2"],
                        ["3", "3", "3"]]),
    "Chunk"
);

const dir_files = fs.readdirSync(BUILD_DIR);
const test_files = dir_files.filter((name) => {
    return name.endsWith(".bin");
}).map(name => {
    return name.slice(0, -4);
});

const nr_of_cpus = Math.min(
    os.cpus().length || 1,
    test_files.length,
    MAX_PARALLEL_PROCS
);
console.log("[+] Using %d cpus to generate fixtures", nr_of_cpus);

const workloads = chunk(test_files, nr_of_cpus);

function test_arg_formatter(workload)
{
    return workload.map(test => {
        const test_path = BUILD_DIR + test;
        return `--eval-command=extract-state ${test_path}.bin ${test_path}.fixture`;
    });
}

function setProcHandlers(proc, n)
{
    proc.on("close", (code) => {
        console.log(`[+] child process ${n} exited with code ${code}`);
        if(code !== 0)
        {
            process.exit(code);
        }
    });

    if(DEBUG)
    {
        proc.stdout.on("data", (data) => {
            console.log(CYAN_FMT, "stdout", `${n}: ${data}`);
        });

        proc.stderr.on("data", (data) => {
            console.log(YELLOW_FMT, "stderr", `${n}: ${data}`);
        });
    }
}

const gdb_args = [];
for(let i = 0; i < nr_of_cpus; i++)
{
    gdb_args[i] = GDB_DEFAULT_ARGS.concat(test_arg_formatter(workloads[i]));

    if(DEBUG)
    {
        console.log(CYAN_FMT, "[DEBUG]", "gdb", gdb_args[i].join(" "));
    }

    const gdb = spawn("gdb", gdb_args[i]);
    setProcHandlers(gdb, i);
}
